import { MockLlmProvider } from "@voicedesk/adapters";
import { emptyProfile } from "@voicedesk/agent-brain";
import { businessProfiles, demos, withTenant } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VoiceGateway } from "../src/lib/voice";
import {
  createHarness,
  makePlatformOwner,
  ORIGIN,
  reauth,
  signUpVerified,
  type TestHarness,
} from "./harness";

const sessions: Parameters<VoiceGateway["createSession"]>[0][] = [];
const voice: VoiceGateway = {
  createSession: (params) => {
    sessions.push(params);
    return Promise.resolve({ url: "wss://example.livekit.cloud", token: "jwt" });
  },
  joinCall: () => Promise.resolve({ url: "wss://example.livekit.cloud", token: "jwt" }),
  dispatchAgent: () => Promise.resolve(),
  endCall: () => Promise.resolve(),
};

/** A mock model that counts as a switched-on provider (demos need AI). */
function availableLlm(): MockLlmProvider {
  const llm = new MockLlmProvider();
  Object.assign(llm, { available: () => Promise.resolve(true) });
  return llm;
}

let on: TestHarness;
let off: TestHarness;
let llm: MockLlmProvider;

beforeAll(async () => {
  llm = availableLlm();
  on = await createHarness({
    llm,
    voice,
    recordSourcesOnly: true,
    demoSettings: { enabled: true, dailyLimit: 1000 },
  });
  off = await createHarness({ llm: availableLlm(), recordSourcesOnly: true });
});
afterAll(async () => {
  await on.close();
  await off.close();
});

let ip = 0;
const create = (h: TestHarness, payload: Record<string, unknown>) =>
  h.app.inject({
    method: "POST",
    url: "/api/public/demos",
    headers: { origin: ORIGIN },
    // A different visitor each time, so the per-IP limit only bites where tested.
    remoteAddress: `198.51.100.${(ip++ % 250) + 1}`,
    payload,
  });

async function readyDemo() {
  const res = await create(on, { website: "glow-studio.test" });
  expect(res.statusCode).toBe(201);
  const { key } = res.json<{ key: string }>();
  const tenantId = key.split(".")[0]!;
  await withTenant(on.db, tenantId, async (tx) => {
    await tx.insert(businessProfiles).values({
      tenantId,
      version: 1,
      status: "approved",
      data: emptyProfile("Glow Studio"),
      generatedBy: "ai",
    });
    await tx.update(demos).set({ status: "ready" }).where(eq(demos.tenantId, tenantId));
  });
  return { key, tenantId };
}

describe("instant demos (ADR 0029)", () => {
  it("are refused while switched off", async () => {
    const config = await off.app.inject({ method: "GET", url: "/api/public/demos/config" });
    expect(config.json()).toMatchObject({ enabled: false });
    expect((await create(off, { website: "glow-studio.test" })).json()).toMatchObject({
      error: "DEMOS_OFF",
    });
  });

  it("start a crawl of the visitor's site and need the key to follow them", async () => {
    const res = await create(on, {
      website: "https://www.glow-studio.test/",
      email: "owner@glow-studio.test",
      consent: true,
    });
    expect(res.statusCode).toBe(201);
    const { key } = res.json<{ key: string }>();
    expect(on.jobs.sources.at(-1)?.tenantId).toBe(key.split(".")[0]);

    const status = await on.app.inject({
      method: "GET",
      url: "/api/public/demos/status",
      headers: { "x-demo-key": key },
    });
    expect(status.json()).toMatchObject({ status: "crawling", chatTurnsLeft: 20 });
    const wrong = await on.app.inject({
      method: "GET",
      url: "/api/public/demos/status",
      headers: { "x-demo-key": `${key.split(".")[0]}.nope` },
    });
    expect(wrong.statusCode).toBe(404);
  });

  it("need consent with an email, and a public website", async () => {
    expect(
      (await create(on, { website: "glow-studio.test", email: "a@b.test" })).json(),
    ).toMatchObject({ error: "CONSENT_REQUIRED" });
    expect((await create(on, { website: "http://127.0.0.1" })).statusCode).toBe(400);
  });

  it("limit each visitor to a few demos an hour", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await on.app.inject({
        method: "POST",
        url: "/api/public/demos",
        headers: { origin: ORIGIN },
        remoteAddress: "203.0.113.9",
        payload: { website: "glow-studio.test" },
      });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([201, 201, 201, 429]);
  });

  it("chat once ready, without ever notifying anyone", async () => {
    const { key } = await readyDemo();
    llm.enqueue(MockLlmProvider.text("We're open nine to six, Monday to Friday."));
    const before = on.jobs.notifications.length;
    const res = await on.app.inject({
      method: "POST",
      url: "/api/public/demos/chat",
      headers: { origin: ORIGIN, "x-demo-key": key },
      payload: { text: "When are you open?" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ conversationId: string; greeting: string; reply: string }>();
    expect(body.greeting).toMatch(/AI/);
    expect(body.reply).toBe("We're open nine to six, Monday to Friday.");
    expect(on.jobs.notifications.length).toBe(before);
  });

  it("voice calls are marked as demos and capped", async () => {
    const { key, tenantId } = await readyDemo();
    const res = await on.app.inject({
      method: "POST",
      url: "/api/public/demos/voice",
      headers: { origin: ORIGIN, "x-demo-key": key },
    });
    expect(res.statusCode).toBe(201);
    expect(sessions.at(-1)?.metadata).toMatchObject({ tenantId, demo: true, maxSeconds: 180 });
    expect(sessions.at(-1)?.identity).toMatch(/^demo-/);
  });

  it("aren't ready for chat while building", async () => {
    const res = await create(on, { website: "glow-studio.test" });
    const { key } = res.json<{ key: string }>();
    const chat = await on.app.inject({
      method: "POST",
      url: "/api/public/demos/chat",
      headers: { origin: ORIGIN, "x-demo-key": key },
      payload: { text: "Hi" },
    });
    expect(chat.json()).toMatchObject({ error: "DEMO_NOT_READY" });
  });

  it("Platform admin → Demos lists them for the platform owner only, and forgets a lead", async () => {
    expect((await on.app.inject({ method: "GET", url: "/api/platform/demos" })).statusCode).toBe(
      401,
    );
    const owner = await signUpVerified(on, "DemoOwner");
    await makePlatformOwner(on, owner);
    await create(on, { website: "leads.test", email: "lead@leads.test", consent: true });
    const res = await on.app.inject({
      method: "GET",
      url: "/api/platform/demos",
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      today: number;
      requests: Array<{ id: string; email: string | null }>;
    }>();
    expect(body.today).toBeGreaterThan(0);
    const lead = body.requests.find((r) => r.email === "lead@leads.test")!;
    await reauth(on, owner.cookie);
    const forget = await on.app.inject({
      method: "DELETE",
      url: `/api/platform/demos/${lead.id}/email`,
      headers: { cookie: owner.cookie, origin: ORIGIN },
    });
    expect(forget.statusCode).toBe(204);
  });
});
