import { MockTextToSpeechProvider } from "@voicedesk/adapters";
import { conversationMessages, conversations, withTenant } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VoiceGateway } from "../src/lib/voice";
import { createHarness, createOwnerWithTenant, ORIGIN, type TestHarness } from "./harness";

const sessions: Parameters<VoiceGateway["createSession"]>[0][] = [];
let failNext = false;
const voice: VoiceGateway = {
  createSession: (params) => {
    if (failNext) {
      failNext = false;
      return Promise.reject(new Error("livekit down"));
    }
    sessions.push(params);
    return Promise.resolve({ url: "wss://example.livekit.cloud", token: "jwt" });
  },
  joinCall: () => Promise.resolve({ url: "wss://example.livekit.cloud", token: "jwt" }),
  endCall: () => Promise.resolve(),
};

let h: TestHarness;
let owner: Awaited<ReturnType<typeof createOwnerWithTenant>>;

beforeAll(async () => {
  h = await createHarness({ voice, tts: new MockTextToSpeechProvider() });
  owner = await createOwnerWithTenant(h, "Voice Co");
});
afterAll(() => h.close());

const headers = () => ({ cookie: owner.cookie, origin: ORIGIN });

describe("voice session", () => {
  it("creates a voice conversation, dispatches the agent and returns a token", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: `/api/tenants/${owner.tenantId}/voice/session`,
      headers: headers(),
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{
      conversationId: string;
      roomName: string;
      token: string;
      greeting: string;
    }>();
    expect(body.roomName).toBe(`vd-${body.conversationId}`);
    expect(body.token).toBe("jwt");
    expect(body.greeting).toMatch(/AI assistant/i);
    expect(sessions.at(-1)).toMatchObject({
      roomName: body.roomName,
      metadata: { tenantId: owner.tenantId, conversationId: body.conversationId },
    });
    const [row] = await withTenant(h.db, owner.tenantId, (tx) =>
      tx.select().from(conversations).where(eq(conversations.id, body.conversationId)),
    );
    expect(row).toMatchObject({ style: "voice", status: "active" });
    const messages = await withTenant(h.db, owner.tenantId, (tx) =>
      tx
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, body.conversationId)),
    );
    expect(messages.map((m) => m.content)).toEqual([body.greeting]);
  });

  it("adds the recording notice when call recording is on", async () => {
    const put = await h.app.inject({
      method: "PUT",
      url: `/api/tenants/${owner.tenantId}/agent`,
      headers: headers(),
      payload: {
        personaId: "amelia",
        personaNames: {},
        enabledLanguages: ["en"],
        adminLanguage: "en",
        recordCalls: true,
      },
    });
    expect(put.statusCode).toBe(204);
    const res = await h.app.inject({
      method: "POST",
      url: `/api/tenants/${owner.tenantId}/voice/session`,
      headers: headers(),
      payload: {},
    });
    expect(res.json<{ greeting: string }>().greeting).toMatch(/call is recorded/);
  });

  it("ends the conversation when the dispatch fails", async () => {
    failNext = true;
    const res = await h.app.inject({
      method: "POST",
      url: `/api/tenants/${owner.tenantId}/voice/session`,
      headers: headers(),
      payload: {},
    });
    expect(res.statusCode).toBe(502);
    const active = await withTenant(h.db, owner.tenantId, (tx) =>
      tx.select().from(conversations).where(eq(conversations.status, "active")),
    );
    expect(active).toHaveLength(2);
  });

  it("refuses other businesses' members", async () => {
    const other = await createOwnerWithTenant(h, "Other Co");
    const res = await h.app.inject({
      method: "POST",
      url: `/api/tenants/${owner.tenantId}/voice/session`,
      headers: { cookie: other.cookie, origin: ORIGIN },
      payload: {},
    });
    expect([403, 404]).toContain(res.statusCode);
  });

  it("speaks a voice preview", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: `/api/tenants/${owner.tenantId}/agent/voice-preview`,
      headers: headers(),
      payload: { personaId: "james", language: "fr" },
    });
    expect(res.statusCode).toBe(200);
    // The mock TTS returns the text it was asked to speak: James's greeting, in French.
    expect(res.body).toMatch(/James/);
    expect(res.body).toMatch(/Voice Co/);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("voice not configured", () => {
  it("returns 503 without LiveKit or TTS", async () => {
    const bare = await createHarness();
    const o = await createOwnerWithTenant(bare, "No Voice Co");
    const hdr = { cookie: o.cookie, origin: ORIGIN };
    const session = await bare.app.inject({
      method: "POST",
      url: `/api/tenants/${o.tenantId}/voice/session`,
      headers: hdr,
      payload: {},
    });
    const preview = await bare.app.inject({
      method: "POST",
      url: `/api/tenants/${o.tenantId}/agent/voice-preview`,
      headers: hdr,
      payload: { personaId: "amelia" },
    });
    expect([session.statusCode, preview.statusCode]).toEqual([503, 503]);
    await bare.close();
  });
});
