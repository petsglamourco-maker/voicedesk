import { user } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PhoneJobMetadata, SipGateway, SipRoute } from "../src/lib/sip";
import {
  createHarness,
  createOwnerWithTenant,
  ORIGIN,
  signUpVerified,
  type TestHarness,
} from "./harness";

const created: Array<{ e164: string; metadata: PhoneJobMetadata }> = [];
const deleted: Array<Partial<SipRoute>> = [];
let failNext = false;
const sip: SipGateway = {
  createRoute: (params) => {
    if (failNext) {
      failNext = false;
      return Promise.reject(new Error("livekit down"));
    }
    created.push(params);
    return Promise.resolve({
      trunkId: `ST_${created.length}`,
      dispatchRuleId: `SDR_${created.length}`,
    });
  },
  deleteRoute: (route) => {
    deleted.push(route);
    return Promise.resolve();
  },
};

interface NumberView {
  id: string;
  tenantId: string;
  e164: string;
  status: string;
  routed: boolean;
}

let h: TestHarness;
let platform: { email: string; cookie: string };
let bizA: Awaited<ReturnType<typeof createOwnerWithTenant>>;
let bizB: Awaited<ReturnType<typeof createOwnerWithTenant>>;
const unique = () => `+44 20 ${Math.floor(1000_0000 + Math.random() * 8999_9999)}`;

beforeAll(async () => {
  h = await createHarness({ sip });
  platform = await signUpVerified(h, "Platform");
  await h.db.update(user).set({ isPlatformOwner: true }).where(eq(user.email, platform.email));
  bizA = await createOwnerWithTenant(h, "Phone A");
  bizB = await createOwnerWithTenant(h, "Phone B");
});
afterAll(() => h.close());

const as = (who: { cookie: string }) => ({ cookie: who.cookie, origin: ORIGIN });

async function register(tenantId: string, e164 = unique()) {
  return h.app.inject({
    method: "POST",
    url: "/api/platform/phone-numbers",
    headers: as(platform),
    payload: { e164, tenantId, label: "Main line" },
  });
}

describe("phone numbers (platform admin)", () => {
  it("registers a number and routes it to the business", async () => {
    const res = await register(bizA.tenantId);
    expect(res.statusCode).toBe(201);
    const view = res.json<NumberView>();
    expect(view).toMatchObject({ tenantId: bizA.tenantId, status: "active", routed: true });
    expect(view.e164).toMatch(/^\+4420\d{8}$/);
    expect(created.at(-1)).toEqual({
      e164: view.e164,
      metadata: { tenantId: bizA.tenantId, phoneNumberId: view.id },
    });

    const own = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${bizA.tenantId}/phone-numbers`,
      headers: as(bizA),
    });
    expect(own.json<{ numbers: NumberView[] }>().numbers.map((n) => n.id)).toContain(view.id);
    const other = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${bizB.tenantId}/phone-numbers`,
      headers: as(bizB),
    });
    expect(other.json<{ numbers: NumberView[] }>().numbers.map((n) => n.id)).not.toContain(view.id);
  });

  it("rejects duplicates and badly formatted numbers", async () => {
    const e164 = unique();
    expect((await register(bizA.tenantId, e164)).statusCode).toBe(201);
    expect((await register(bizB.tenantId, e164)).statusCode).toBe(409);
    expect((await register(bizA.tenantId, "020 7946 0000")).statusCode).toBe(400);
  });

  it("does not keep a number LiveKit could not route", async () => {
    failNext = true;
    const e164 = unique();
    expect((await register(bizA.tenantId, e164)).statusCode).toBe(502);
    const list = await h.app.inject({
      method: "GET",
      url: "/api/platform/phone-numbers",
      headers: as(platform),
    });
    const numbers = list.json<{ numbers: NumberView[] }>().numbers;
    expect(numbers.map((n) => n.e164)).not.toContain(e164.replace(/\s/g, ""));
  });

  it("rebuilds the route when reassigned, removes it when disabled or deleted", async () => {
    const view = (await register(bizA.tenantId)).json<NumberView>();
    const moved = await h.app.inject({
      method: "PATCH",
      url: `/api/platform/phone-numbers/${view.id}`,
      headers: as(platform),
      payload: { tenantId: bizB.tenantId },
    });
    expect(moved.json<NumberView>()).toMatchObject({ tenantId: bizB.tenantId, routed: true });
    expect(created.at(-1)?.metadata.tenantId).toBe(bizB.tenantId);

    const off = await h.app.inject({
      method: "PATCH",
      url: `/api/platform/phone-numbers/${view.id}`,
      headers: as(platform),
      payload: { status: "disabled" },
    });
    expect(off.json<NumberView>()).toMatchObject({ status: "disabled", routed: false });

    const before = deleted.length;
    const del = await h.app.inject({
      method: "DELETE",
      url: `/api/platform/phone-numbers/${view.id}`,
      headers: as(platform),
    });
    expect(del.statusCode).toBe(204);
    expect(deleted.length).toBe(before); // already unrouted when disabled
  });

  it("is invisible to businesses", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: "/api/platform/phone-numbers",
      headers: as(bizA),
    });
    expect(res.statusCode).toBe(404);
    const post = await h.app.inject({
      method: "POST",
      url: "/api/platform/phone-numbers",
      headers: as(bizA),
      payload: { e164: unique(), tenantId: bizA.tenantId },
    });
    expect(post.statusCode).toBe(404);
  });
});
