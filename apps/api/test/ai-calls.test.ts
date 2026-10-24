import {
  agentSettings,
  conversationMessages,
  outboundCalls,
  staffMessages,
  user,
  withTenant,
} from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dialDueCalls } from "../src/lib/outbound-dialer";
import type { PhoneCarrier, SipGateway } from "../src/lib/sip";
import type { VoiceGateway } from "../src/lib/voice";
import {
  createHarness,
  createOwnerWithTenant,
  ORIGIN,
  signUpVerified,
  type TestHarness,
} from "./harness";

const dials: Array<Parameters<SipGateway["dial"]>[0]> = [];
const dispatched: Array<[string, Record<string, unknown>]> = [];
let configured: PhoneCarrier[] = ["twilio"];
const sip: SipGateway = {
  createRoute: () => Promise.resolve({ trunkId: "ST_1", dispatchRuleId: "SDR_1" }),
  deleteRoute: () => Promise.resolve(),
  canDial: (c) => configured.includes(c),
  dial: (p) => {
    dials.push(p);
    return Promise.resolve();
  },
};
const voice: VoiceGateway = {
  createSession: () => Promise.resolve({ url: "wss://lk", token: "t" }),
  joinCall: () => Promise.resolve({ url: "wss://lk", token: "t" }),
  endCall: () => Promise.resolve(),
  dispatchAgent: (room, metadata) => {
    dispatched.push([room, metadata]);
    return Promise.resolve();
  },
};
const log = { info: () => undefined, warn: () => undefined };

let h: TestHarness;
let biz: Awaited<ReturnType<typeof createOwnerWithTenant>>;
const NUMBER = `+4420${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
// A Tuesday, 10:00 in London (BST).
const DAYTIME = new Date("2026-10-20T09:00:00Z");
const NIGHT = new Date("2026-10-20T21:30:00Z");

beforeAll(async () => {
  h = await createHarness({ sip, voice });
  const platform = await signUpVerified(h, "Platform");
  await h.db
    .update(user)
    .set({ isPlatformOwner: true, twoFactorEnabled: true })
    .where(eq(user.email, platform.email));
  biz = await createOwnerWithTenant(h, "Callback Co");
  await h.app.inject({
    method: "POST",
    url: "/api/platform/phone-numbers",
    headers: { cookie: platform.cookie, origin: ORIGIN },
    payload: { e164: NUMBER, tenantId: biz.tenantId },
  });
  await withTenant(h.db, biz.tenantId, (tx) =>
    tx.insert(agentSettings).values({ tenantId: biz.tenantId, aiCallbacks: true }),
  );
});
afterAll(() => h.close());

async function message(phone: string) {
  const [row] = await withTenant(h.db, biz.tenantId, (tx) =>
    tx
      .insert(staffMessages)
      .values({
        tenantId: biz.tenantId,
        reference: `CB-${Math.random().toString(36).slice(2, 7)}`,
        callerName: "Pat",
        callerPhone: phone,
        reason: "Question about my invoice",
      })
      .returning(),
  );
  return row!;
}

async function schedule(sourceId: string) {
  return h.app.inject({
    method: "POST",
    url: `/api/tenants/${biz.tenantId}/ai-calls`,
    headers: { cookie: biz.cookie, origin: ORIGIN },
    payload: { sourceType: "message", sourceId, at: "2026-10-20T08:00:00Z" },
  });
}

const callRow = async (id: string) =>
  (
    await withTenant(h.db, biz.tenantId, (tx) =>
      tx.select().from(outboundCalls).where(eq(outboundCalls.id, id)),
    )
  )[0]!;

describe("calls the assistant places", () => {
  it("a scheduled callback is placed: assistant sent in, customer rung from the business's number", async () => {
    const m = await message("+447700900301");
    const res = await schedule(m.id);
    expect(res.statusCode).toBe(201);
    const id = res.json<{ id: string }>().id;
    expect((await schedule(m.id)).statusCode).toBe(409); // one call per request

    expect(await dialDueCalls({ db: h.db, sip, voice, log }, DAYTIME, [biz.tenantId])).toBe(1);
    const row = await callRow(id);
    expect(row).toMatchObject({ status: "calling", attempts: 1 });
    expect(dials.at(-1)).toMatchObject({
      from: NUMBER,
      to: "+447700900301",
      participantIdentity: "customer",
    });
    const [room, metadata] = dispatched.at(-1)!;
    expect(room).toBe(dials.at(-1)!.roomName);
    expect(metadata).toMatchObject({
      kind: "outbound",
      outboundCallId: id,
      callbackNumber: NUMBER,
    });

    // The conversation opens with the disclosure and the reason it's calling.
    const [opening] = await withTenant(h.db, biz.tenantId, (tx) =>
      tx
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, metadata.conversationId as string)),
    );
    expect(opening?.content).toMatch(/the AI assistant for .*calling you back/);
  });

  it("outside calling hours it waits; without an outbound trunk it fails clearly", async () => {
    const late = await message("+447700900302");
    const id = (await schedule(late.id)).json<{ id: string }>().id;
    await dialDueCalls({ db: h.db, sip, voice, log }, NIGHT, [biz.tenantId]);
    expect(await callRow(id)).toMatchObject({
      status: "scheduled",
      attempts: 0,
      outcome: "after calling hours",
    });

    configured = [];
    await dialDueCalls({ db: h.db, sip, voice, log }, new Date("2026-10-21T09:00:00Z"), [
      biz.tenantId,
    ]);
    expect(await callRow(id)).toMatchObject({ status: "failed" });
    configured = ["twilio"];
  });

  it("staff can see and cancel planned calls", async () => {
    const m = await message("+447700900303");
    const id = (await schedule(m.id)).json<{ id: string }>().id;
    const list = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/ai-calls`,
      headers: { cookie: biz.cookie, origin: ORIGIN },
    });
    expect(list.json<{ calls: Array<{ id: string }> }>().calls.map((c) => c.id)).toContain(id);
    const cancel = await h.app.inject({
      method: "DELETE",
      url: `/api/tenants/${biz.tenantId}/ai-calls/${id}`,
      headers: { cookie: biz.cookie, origin: ORIGIN },
    });
    expect(cancel.json()).toEqual({ status: "cancelled" });
  });
});
