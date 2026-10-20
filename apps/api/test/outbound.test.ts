import { conversations, user, withTenant } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PhoneCarrier, SipGateway } from "../src/lib/sip";
import type { VoiceGateway } from "../src/lib/voice";
import { outboundRefusal } from "../src/routes/outbound";
import {
  createHarness,
  createOwnerWithTenant,
  ORIGIN,
  signUpVerified,
  type TestHarness,
} from "./harness";

const dials: Array<Parameters<SipGateway["dial"]>[0]> = [];
const ended: string[] = [];
let configured: PhoneCarrier[] = ["twilio"];
const sip: SipGateway = {
  createRoute: () => Promise.resolve({ trunkId: "ST_1", dispatchRuleId: "SDR_1" }),
  deleteRoute: () => Promise.resolve(),
  canDial: (carrier) => configured.includes(carrier),
  dial: (params) => {
    dials.push(params);
    return Promise.resolve();
  },
};
const voice: VoiceGateway = {
  createSession: () => Promise.resolve({ url: "wss://lk.example", token: "t" }),
  joinCall: (p) => Promise.resolve({ url: "wss://lk.example", token: `jwt-${p.identity}` }),
  dispatchAgent: () => Promise.resolve(),
  endCall: (room) => {
    ended.push(room);
    return Promise.resolve();
  },
};

let h: TestHarness;
let biz: Awaited<ReturnType<typeof createOwnerWithTenant>>;
const as = (who: { cookie: string }) => ({ cookie: who.cookie, origin: ORIGIN });
const NUMBER = `+4420${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

beforeAll(async () => {
  h = await createHarness({ sip, voice });
  const platform = await signUpVerified(h, "Platform");
  await h.db.update(user).set({ isPlatformOwner: true }).where(eq(user.email, platform.email));
  biz = await createOwnerWithTenant(h, "Outbound Co");
  await h.app.inject({
    method: "POST",
    url: "/api/platform/phone-numbers",
    headers: as(platform),
    payload: { e164: NUMBER, tenantId: biz.tenantId },
  });
  // The owner answers calls for their own business.
  const [owner] = await h.db.select({ id: user.id }).from(user).where(eq(user.email, biz.email));
  await h.app.inject({
    method: "PUT",
    url: `/api/tenants/${biz.tenantId}/answerers/${owner!.id}`,
    headers: as(biz),
    payload: { on: true },
  });
});
afterAll(() => h.close());

const call = (payload: Record<string, unknown>) =>
  h.app.inject({
    method: "POST",
    url: `/api/tenants/${biz.tenantId}/outbound-calls`,
    headers: as(biz),
    payload,
  });

describe("outboundRefusal", () => {
  const at = (iso: string) => new Date(iso);
  it("keeps unsolicited calls to 8am–9pm local time; callbacks may go outside", () => {
    const tz = "Europe/London";
    expect(
      outboundRefusal({
        now: at("2026-10-20T07:30:00Z"),
        timezone: tz,
        callback: false,
        doNotCall: false,
      }),
    ).toBeNull(); // 08:30 BST
    expect(
      outboundRefusal({
        now: at("2026-10-20T20:30:00Z"),
        timezone: tz,
        callback: false,
        doNotCall: false,
      })?.code,
    ).toBe("OUTSIDE_CALLING_HOURS"); // 21:30
    expect(
      outboundRefusal({
        now: at("2026-10-20T20:30:00Z"),
        timezone: tz,
        callback: true,
        doNotCall: false,
      }),
    ).toBeNull();
    expect(
      outboundRefusal({
        now: at("2026-10-20T12:00:00Z"),
        timezone: tz,
        callback: true,
        doNotCall: true,
      })?.code,
    ).toBe("DO_NOT_CALL");
  });
});

describe("outbound calls", () => {
  it("rings the customer from the business's number and logs an outbound call", async () => {
    const res = await call({ to: "07700 900555", callback: true });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ conversationId: string; token: string }>();
    expect(body.token).toMatch(/^jwt-va-/);
    expect(dials.at(-1)).toMatchObject({
      carrier: "twilio",
      from: NUMBER,
      to: "+447700900555",
      roomName: `out-${body.conversationId}`,
    });
    const [row] = await withTenant(h.db, biz.tenantId, (tx) =>
      tx.select().from(conversations).where(eq(conversations.id, body.conversationId)),
    );
    expect(row).toMatchObject({ direction: "outbound", status: "active", channel: "voice" });

    const end = await h.app.inject({
      method: "POST",
      url: `/api/tenants/${biz.tenantId}/outbound-calls/${body.conversationId}/end`,
      headers: as(biz),
    });
    expect(end.json()).toEqual({ ended: true });
    expect(ended).toEqual([`out-${body.conversationId}`]);
  });

  it("refuses contacts who asked not to be phoned", async () => {
    const created = await h.app.inject({
      method: "POST",
      url: `/api/tenants/${biz.tenantId}/contacts`,
      headers: as(biz),
      payload: { fullName: "No Calls", phone: "07700 900666", doNotCall: true },
    });
    expect(created.statusCode).toBeLessThan(300);
    const res = await call({ to: "07700900666", callback: true });
    expect(res.json()).toMatchObject({ error: "DO_NOT_CALL" });
  });

  it("explains when outbound calling isn't set up for the number's carrier", async () => {
    configured = [];
    const res = await call({ to: "07700900777", callback: true });
    expect(res.json()).toMatchObject({ error: "OUTBOUND_NOT_CONFIGURED" });
    configured = ["twilio"];
  });

  it("only people who take calls for the business can dial", async () => {
    const outsider = await signUpVerified(h, "Nosy");
    const res = await h.app.inject({
      method: "POST",
      url: `/api/tenants/${biz.tenantId}/outbound-calls`,
      headers: as(outsider),
      payload: { to: "07700900888" },
    });
    expect(res.statusCode).toBe(404);
  });
});
