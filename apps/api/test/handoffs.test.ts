import { createConversation, loadAgentContext } from "@voicedesk/agent-brain";
import { createHandoff, getHandoff } from "@voicedesk/core";
import { auditLog, user, withTenant } from "@voicedesk/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VoiceGateway } from "../src/lib/voice";
import {
  createHarness,
  createOwnerWithTenant,
  ORIGIN,
  signUpVerified,
  type TestHarness,
} from "./harness";

const joins: Array<Parameters<VoiceGateway["joinCall"]>[0]> = [];
const ended: string[] = [];
const voice: VoiceGateway = {
  createSession: () => Promise.resolve({ url: "wss://lk.example", token: "t" }),
  joinCall: (params) => {
    joins.push(params);
    return Promise.resolve({ url: "wss://lk.example", token: `jwt-${params.identity}` });
  },
  dispatchAgent: () => Promise.resolve(),
  endCall: (room) => {
    ended.push(room);
    return Promise.resolve();
  },
};

let h: TestHarness;
let platform: { email: string; cookie: string };
let biz: Awaited<ReturnType<typeof createOwnerWithTenant>>;
let vaOne: { email: string; cookie: string };
let vaTwo: { email: string; cookie: string };

const as = (who: { cookie: string }) => ({ cookie: who.cookie, origin: ORIGIN });

async function newHandoff(reason = "Wants to talk about an invoice") {
  const ctx = await loadAgentContext(h.db, biz.tenantId, "voice");
  const { conversationId } = await createConversation(h.db, ctx, {
    tenantId: biz.tenantId,
    channel: "voice",
    callerPhone: "+447700900321",
  });
  return createHandoff(h.db, {
    tenantId: biz.tenantId,
    conversationId,
    roomName: `call-${conversationId}`,
    reason,
    urgent: false,
  });
}

beforeAll(async () => {
  h = await createHarness({ voice });
  platform = await signUpVerified(h, "Platform");
  await h.db.update(user).set({ isPlatformOwner: true }).where(eq(user.email, platform.email));
  biz = await createOwnerWithTenant(h, "Handoff Co");
  vaOne = await signUpVerified(h, "Sam");
  vaTwo = await signUpVerified(h, "Alex");
  for (const va of [vaOne, vaTwo]) {
    await h.app.inject({
      method: "POST",
      url: "/api/platform/vas",
      headers: as(platform),
      payload: { email: va.email, tenantId: biz.tenantId },
    });
    await h.app.inject({
      method: "PUT",
      url: "/api/va/presence",
      headers: as(va),
      payload: { status: "available" },
    });
  }
});
afterAll(() => h.close());

const url = (id: string, action: string) => `/api/tenants/${biz.tenantId}/handoffs/${id}/${action}`;

describe("handed-off calls", () => {
  it("rings in the queue; the first to answer gets the room and context, the other is told", async () => {
    const handoff = await newHandoff();
    const queue = await h.app.inject({ method: "GET", url: "/api/va/queue", headers: as(vaOne) });
    expect(queue.json<{ calls: unknown[] }>().calls).toEqual([
      expect.objectContaining({
        id: handoff.id,
        businessName: "Handoff Co",
        callerPhone: "+447700900321",
        reason: "Wants to talk about an invoice",
      }),
    ]);

    const [first, second] = await Promise.all([
      h.app.inject({ method: "POST", url: url(handoff.id, "answer"), headers: as(vaOne) }),
      h.app.inject({ method: "POST", url: url(handoff.id, "answer"), headers: as(vaTwo) }),
    ]);
    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([200, 409]);
    const winner = first.statusCode === 200 ? first : second;
    expect(winner.json()).toMatchObject({
      url: "wss://lk.example",
      handoffId: handoff.id,
      context: { callerPhone: "+447700900321", transcript: expect.any(Array) as unknown },
    });
    expect(joins).toHaveLength(1);
    expect(joins[0]).toMatchObject({ roomName: handoff.roomName });
    expect(joins[0]!.identity).toMatch(/^va-/);
    expect(["Sam", "Alex"]).toContain(joins[0]!.displayName);
    expect((await getHandoff(h.db, biz.tenantId, handoff.id))?.status).toBe("answered");
  });

  it("hand back and hang up only work for the person on the call", async () => {
    const handoff = await newHandoff();
    await h.app.inject({ method: "POST", url: url(handoff.id, "answer"), headers: as(vaOne) });
    const notMine = await h.app.inject({
      method: "POST",
      url: url(handoff.id, "return"),
      headers: as(vaTwo),
    });
    expect(notMine.statusCode).toBe(409);

    const back = await h.app.inject({
      method: "POST",
      url: url(handoff.id, "return"),
      headers: as(vaOne),
    });
    expect(back.json()).toEqual({ status: "returned" });
    expect(ended).toEqual([]);

    // The call's page shows who took it and that it went back to the assistant.
    const detail = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/calls/${handoff.conversationId}`,
      headers: as(biz),
    });
    expect(detail.json<{ handoffs: unknown[] }>().handoffs).toEqual([
      expect.objectContaining({ status: "returned", answeredBy: "Sam" }),
    ]);

    const other = await newHandoff();
    await h.app.inject({ method: "POST", url: url(other.id, "answer"), headers: as(vaTwo) });
    const hang = await h.app.inject({
      method: "POST",
      url: url(other.id, "end"),
      headers: as(vaTwo),
    });
    expect(hang.json()).toEqual({ status: "ended" });
    expect(ended).toEqual([other.roomName]);

    const audits = await withTenant(h.db, biz.tenantId, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, biz.tenantId), eq(auditLog.targetType, "conversation"))),
    );
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(["handoff.answered", "handoff.returned", "handoff.ended"]),
    );
  });

  it("people who don't answer for the business can't pick up its calls", async () => {
    const handoff = await newHandoff();
    // The owner is a member but hasn't switched on "Answers calls".
    const res = await h.app.inject({
      method: "POST",
      url: url(handoff.id, "answer"),
      headers: as(biz),
    });
    expect(res.statusCode).toBe(403);
    const outsider = await signUpVerified(h, "Outsider");
    const res2 = await h.app.inject({
      method: "POST",
      url: url(handoff.id, "answer"),
      headers: as(outsider),
    });
    expect(res2.statusCode).toBe(404);
  });
});
