import { MockHumanCheck, MockLlmProvider } from "@voicedesk/adapters";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signWidgetToken, verifyWidgetToken } from "../src/lib/widget-token";
import {
  createHarness,
  createOwnerWithTenant,
  ORIGIN,
  widgetToken,
  type TestHarness,
} from "./harness";

/** Website chat protection (security audit M3, ADR 0022): bot check and stream limits. */
let h: TestHarness;
let key: string;
let tenantId: string;
let ownerCookie: string;
const human = new MockHumanCheck();
const llm = new MockLlmProvider();

beforeAll(async () => {
  h = await createHarness({ llm, humanCheck: human });
  const owner = await createOwnerWithTenant(h, "Guarded Chat Co");
  tenantId = owner.tenantId;
  ownerCookie = owner.cookie;
  const get = await h.app.inject({
    method: "GET",
    url: `/api/tenants/${owner.tenantId}/widget`,
    headers: { cookie: owner.cookie, origin: ORIGIN },
  });
  key = get.json<{ key: string }>().key;
  await h.app.inject({
    method: "PUT",
    url: `/api/tenants/${owner.tenantId}/widget`,
    headers: { cookie: owner.cookie, origin: ORIGIN },
    payload: {
      enabled: true,
      allowedOrigins: ["https://shop.example.com"],
      color: "#0f766e",
      title: "Guarded chat",
      position: "right",
    },
  });
});
afterAll(() => h.close());

const session = async (body: Record<string, unknown>) =>
  h.app.inject({
    method: "POST",
    url: `/api/public/chat/${key}/session`,
    payload: { token: await widgetToken(h, key), ...body },
  });

describe("widget token", () => {
  it("expires after two hours and is bound to one widget", () => {
    const now = Date.now();
    const token = signWidgetToken("secret", "pk_one", now);
    expect(verifyWidgetToken("secret", "pk_one", token, now)).toBe(true);
    expect(verifyWidgetToken("secret", "pk_two", token, now)).toBe(false);
    expect(verifyWidgetToken("other", "pk_one", token, now)).toBe(false);
    expect(verifyWidgetToken("secret", "pk_one", token, now + 2 * 60 * 60 * 1000 + 1000)).toBe(
      false,
    );
  });
});

describe("bot check (Turnstile) when switched on", () => {
  it("puts the site key in the frame", async () => {
    const frame = await h.app.inject({ method: "GET", url: `/api/public/chat/${key}/frame` });
    expect(frame.body).toContain(`"siteKey":"${human.siteKey}"`);
  });

  it("refuses visitors who fail it, and remembers those who pass", async () => {
    expect((await session({})).statusCode).toBe(403);
    expect((await session({ human: "robot" })).json()).toMatchObject({
      error: "HUMAN_CHECK_FAILED",
    });

    const ok = await session({ human: "human" });
    expect(ok.statusCode).toBe(200);
    const { visitorId } = ok.json<{ visitorId: string }>();
    // Resuming doesn't need a new check.
    const checks = human.checked.length;
    expect((await session({ visitorId })).statusCode).toBe(200);
    expect(human.checked.length).toBe(checks);

    llm.enqueue(MockLlmProvider.text("Hello!"));
    const sent = await h.app.inject({
      method: "POST",
      url: `/api/public/chat/${key}/messages`,
      payload: { visitorId, token: await widgetToken(h, key), text: "Hi", typedMs: 4000 },
    });
    expect(sent.statusCode).toBe(200);

    // A visitor id that never passed can't send.
    const stranger = await h.app.inject({
      method: "POST",
      url: `/api/public/chat/${key}/messages`,
      payload: {
        visitorId: "x".repeat(24),
        token: await widgetToken(h, key),
        text: "Hi",
        typedMs: 4000,
      },
    });
    expect(stranger.statusCode).toBe(403);
  });

  it("lets visitors through when the check can't be reached (limits still apply)", async () => {
    expect((await session({ human: "down" })).statusCode).toBe(200);
  });
});

describe("live stream limits", () => {
  it("refuses more open streams than allowed for one visitor", async () => {
    const visitorId = "s".repeat(24);
    for (let i = 0; i < 3; i++) await h.kv.incr(`streams:v:${visitorId}`, 3600);
    const res = await h.app.inject({
      method: "GET",
      url: `/api/public/chat/${key}/events?visitorId=${visitorId}&t=${encodeURIComponent(await widgetToken(h, key))}`,
    });
    expect(res.statusCode).toBe(429);
    // The refused attempt didn't leave its own count behind.
    expect(await h.kv.get(`streams:v:${visitorId}`)).toBe("3");
  });

  it("releases the count when a visitor without a thread disconnects", async () => {
    const visitorId = "r".repeat(24);
    const res = await h.app.inject({
      method: "GET",
      url: `/api/public/chat/${key}/events?visitorId=${visitorId}&t=${encodeURIComponent(await widgetToken(h, key))}`,
    });
    expect(res.statusCode).toBe(200);
    expect(await h.kv.get(`streams:v:${visitorId}`)).toBeNull();
  });
});

describe("hosted enquiry form with the bot check on", () => {
  it("refuses a failed check and accepts a passed one", async () => {
    const settings = await h.app.inject({
      method: "PUT",
      url: `/api/tenants/${tenantId}/forms`,
      headers: { cookie: ownerCookie, origin: ORIGIN },
      payload: { enabled: true, title: "Ask us", intro: "", fieldMap: {} },
    });
    const formKey = settings.json<{ key: string }>().key;
    const info = await h.app.inject({ method: "GET", url: `/api/public/forms/${formKey}` });
    expect(info.json()).toMatchObject({ siteKey: human.siteKey });
    const submit = (extra: Record<string, unknown>) =>
      h.app.inject({
        method: "POST",
        url: `/api/public/forms/${formKey}`,
        headers: { origin: ORIGIN },
        payload: {
          name: "Sam",
          email: "sam@example.com",
          message: "Do you do weekend appointments?",
          consent: true,
          elapsedMs: 9000,
          ...extra,
        },
      });
    expect((await submit({ human: "robot" })).statusCode).toBe(403);
    expect((await submit({})).statusCode).toBe(403);
    expect((await submit({ human: "human" })).statusCode).toBe(202);
  });
});
