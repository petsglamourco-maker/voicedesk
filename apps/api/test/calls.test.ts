import { createConversation, loadAgentContext } from "@voicedesk/agent-brain";
import {
  auditLog,
  conversations,
  phoneNumbers,
  user,
  withPlatformAccess,
  withTenant,
} from "@voicedesk/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { maskPhone, percentile } from "../src/routes/calls";
import { createHarness, createOwnerWithTenant, ORIGIN, type TestHarness } from "./harness";

let h: TestHarness;
let owner: Awaited<ReturnType<typeof createOwnerWithTenant>>;
let callId: string;

beforeAll(async () => {
  h = await createHarness();
  owner = await createOwnerWithTenant(h, "Calls Co");
  const ctx = await loadAgentContext(h.db, owner.tenantId, "voice");
  const created = await createConversation(h.db, ctx, {
    tenantId: owner.tenantId,
    channel: "voice",
    callerPhone: "+447700900123",
  });
  callId = created.conversationId;
  // The call came in on a Telnyx number.
  const [me] = await h.db.select({ id: user.id }).from(user).where(eq(user.email, owner.email));
  const [number] = await withPlatformAccess(
    h.db,
    { actorUserId: me!.id, reason: "test number" },
    (tx) =>
      tx
        .insert(phoneNumbers)
        .values({
          tenantId: owner.tenantId,
          e164: `+4420${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
          provider: "telnyx",
        })
        .returning(),
  );
  const key = `tenants/${owner.tenantId}/recordings/${callId}.wav`;
  await h.storage.put({ key, body: new Uint8Array([82, 73, 70, 70]), contentType: "audio/wav" });
  await withTenant(h.db, owner.tenantId, (tx) =>
    tx
      .update(conversations)
      .set({
        status: "ended",
        endedAt: new Date(Date.now() + 65_000),
        recordingKey: key,
        phoneNumberId: number!.id,
        voiceMetrics: {
          turns: [{ totalMs: 900 }, { totalMs: 1100 }, { totalMs: 2000 }, {}],
          medianMs: 1100,
        },
      })
      .where(eq(conversations.id, callId)),
  );
  // A chat conversation must not appear in the call log.
  const chat = await loadAgentContext(h.db, owner.tenantId, "chat");
  await createConversation(h.db, chat, { tenantId: owner.tenantId, channel: "test_console" });
});
afterAll(() => h.close());

const headers = (cookie: string) => ({ cookie, origin: ORIGIN });

interface CallList {
  calls: Array<{
    id: string;
    callerPhone: string;
    durationSeconds: number;
    hasRecording: boolean;
    test: boolean;
  }>;
  latency: {
    medianMs: number;
    p90Ms: number;
    turns: number;
    byCarrier: Array<{ carrier: string; calls: number; medianMs: number }>;
  };
}

describe("call log", () => {
  it("lists voice calls with duration and the 7-day latency", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${owner.tenantId}/calls`,
      headers: headers(owner.cookie),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<CallList>();
    expect(body.calls).toHaveLength(1);
    expect(body.calls[0]).toMatchObject({
      id: callId,
      callerPhone: "+447700900123",
      hasRecording: true,
      test: false,
    });
    expect(body.calls[0]!.durationSeconds).toBeGreaterThanOrEqual(64);
    expect(body.latency).toMatchObject({ turns: 3, medianMs: 1100, p90Ms: 2000 });
    expect(body.calls[0]).toMatchObject({ carrier: "telnyx" });
    expect(body.latency.byCarrier).toEqual([
      { carrier: "telnyx", calls: 1, medianMs: 1100, p90Ms: 2000 },
    ]);
  });

  it("shows the transcript and plays the recording", async () => {
    const detail = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${owner.tenantId}/calls/${callId}`,
      headers: headers(owner.cookie),
    });
    const body = detail.json<{ messages: Array<{ role: string; content: string }> }>();
    expect(body.messages[0]?.content).toMatch(/AI/);
    const audio = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${owner.tenantId}/calls/${callId}/recording`,
      headers: headers(owner.cookie),
    });
    expect(audio.statusCode).toBe(200);
    expect(audio.headers["content-type"]).toBe("audio/wav");
    // Listening to a recording is audited (security audit H6).
    const audits = await withTenant(h.db, owner.tenantId, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "call.recording_downloaded"), eq(auditLog.targetId, callId))),
    );
    expect(audits.length).toBeGreaterThan(0);
  });

  it("is invisible to other businesses", async () => {
    const other = await createOwnerWithTenant(h, "Other Calls Co");
    for (const url of [
      `/api/tenants/${owner.tenantId}/calls`,
      `/api/tenants/${owner.tenantId}/calls/${callId}`,
      `/api/tenants/${owner.tenantId}/calls/${callId}/recording`,
      `/api/tenants/${other.tenantId}/calls/${callId}`,
      `/api/tenants/${other.tenantId}/calls/${callId}/recording`,
    ]) {
      const res = await h.app.inject({ method: "GET", url, headers: headers(other.cookie) });
      expect(res.statusCode, url).toBe(404);
    }
  });
});

describe("helpers", () => {
  it("masks numbers and computes percentiles", () => {
    expect(maskPhone("+447700900123", false)).toBe("•••• 123");
    expect(maskPhone(null, true)).toBeNull();
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 90)).toBe(5);
    expect(percentile([], 50)).toBeNull();
  });
});
