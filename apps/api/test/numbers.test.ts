import { MockBilling, MockCarrierNumbers, type BillingSubscription } from "@voicedesk/adapters";
import { numberOrders, phoneNumbers, withPlatformAccess } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processNumberOrders } from "../src/lib/number-buyer";
import type { SipGateway } from "../src/lib/sip";
import { createHarness, createOwnerWithTenant, ORIGIN, reauth, type TestHarness } from "./harness";

const PRICES = {
  starter: "price_starter",
  growth: "price_growth",
  pro: "price_pro",
  number_local: "price_number_local",
  number_mobile: "price_number_mobile",
};
const billing = new MockBilling();
const carrier = new MockCarrierNumbers();
const routes: Array<{ e164: string }> = [];
const removed: unknown[] = [];
const sip: SipGateway = {
  createRoute: (params) => {
    routes.push(params);
    return Promise.resolve({
      trunkId: `ST_${routes.length}`,
      dispatchRuleId: `SDR_${routes.length}`,
    });
  },
  deleteRoute: (route) => {
    removed.push(route);
    return Promise.resolve();
  },
} as SipGateway;
const settings = { autoBuy: true, dailyLimit: 1000, perBusiness: 10 };
/** A number nobody has used in this database yet. */
let counter = 0;
const fresh = () => `+44238${String(Date.now()).slice(-5)}${String(counter++).padStart(2, "0")}`;
let h: TestHarness;
const log = { info: () => undefined, warn: () => undefined };

beforeAll(async () => {
  h = await createHarness({
    billing,
    billingPrices: PRICES,
    carrierNumbers: carrier,
    numberSettings: settings,
    sip,
  });
});
afterAll(() => h.close());

const as = (cookie: string) => ({ cookie, origin: ORIGIN });

/** A business on the Growth plan (one included number), paid through Stripe. */
async function paidBusiness(name: string) {
  const biz = await createOwnerWithTenant(h, name);
  const sub: BillingSubscription = {
    id: `sub_${biz.tenantId.slice(0, 8)}`,
    customerId: `cus_${biz.tenantId.slice(0, 8)}`,
    tenantId: biz.tenantId,
    priceId: PRICES.growth,
    items: [{ priceId: PRICES.growth, quantity: 1 }],
    status: "active",
    currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    cancelAtPeriodEnd: false,
  };
  billing.subscriptions.set(sub.id, sub);
  const body = JSON.stringify({
    id: `evt_${sub.id}`,
    kind: "checkout_completed",
    tenantId: biz.tenantId,
    customerId: sub.customerId,
    subscriptionId: sub.id,
  });
  const res = await h.app.inject({
    method: "POST",
    url: "/api/webhooks/stripe",
    headers: { "content-type": "application/json", "stripe-signature": MockBilling.sign(body) },
    payload: body,
  });
  expect(res.statusCode).toBe(200);
  return { ...biz, sub };
}

const DETAILS = {
  type: "local",
  businessName: "Glow Studio Ltd",
  registrationNumber: "12345678",
  website: "https://glow-studio.test",
  contactFirstName: "Sam",
  contactLastName: "Lee",
  contactEmail: "sam@glow-studio.test",
  contactPhone: "+447700900123",
  address: {
    street: "1 High Street",
    city: "Southampton",
    region: "Hampshire",
    postalCode: "SO14 1AA",
  },
};

describe("automatic numbers (ADR 0032)", () => {
  it("are for paid plans only", async () => {
    const trial = await createOwnerWithTenant(h, "Trial Numbers Co");
    const res = await h.app.inject({
      method: "POST",
      url: `/api/tenants/${trial.tenantId}/numbers/identity`,
      headers: as(trial.cookie),
      payload: DETAILS,
    });
    expect(res.statusCode).toBe(402);
    const view = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${trial.tenantId}/numbers`,
      headers: as(trial.cookie),
    });
    expect(view.json()).toMatchObject({ paidPlan: false, allowance: { included: 1, extra: 0 } });
  });

  it("send details for review, pick a number, and it's bought and routed once approved", async () => {
    const biz = await paidBusiness("Glow Studio");
    const submitted = await h.app.inject({
      method: "POST",
      url: `/api/tenants/${biz.tenantId}/numbers/identity`,
      headers: as(biz.cookie),
      payload: DETAILS,
    });
    expect(submitted.statusCode).toBe(201);
    const [identityId, identity] = [...carrier.identities.entries()].at(-1)!;
    expect(identity.details).toMatchObject({ businessName: "Glow Studio Ltd", countryCode: "GB" });

    const search = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/numbers/search?type=local&area=023`,
      headers: as(biz.cookie),
    });
    const [pick] = search.json<{ numbers: Array<{ e164: string }> }>().numbers;
    const order = await h.app.inject({
      method: "POST",
      url: `/api/tenants/${biz.tenantId}/numbers/orders`,
      headers: as(biz.cookie),
      payload: { type: "local", e164: pick!.e164, area: "023", kind: "included" },
    });
    expect(order.json()).toMatchObject({ status: "waiting_review" });

    // Nothing is bought while the carrier is still reviewing.
    await processNumberOrders(
      { db: h.db, carrier, sip, voiceUrl: "https://twiml.test/bin", log, settings },
      new Date(),
      [biz.tenantId],
    );
    expect(carrier.bought.find((b) => b.e164 === pick!.e164)).toBeUndefined();

    carrier.decide(identityId, "approved");
    const pass = await processNumberOrders(
      { db: h.db, carrier, sip, voiceUrl: "https://twiml.test/bin", log, settings },
      new Date(),
      [biz.tenantId],
    );
    expect(pass.bought).toBe(1);
    expect(carrier.bought.at(-1)).toMatchObject({
      e164: pick!.e164,
      voiceUrl: "https://twiml.test/bin",
    });
    expect(routes.at(-1)).toMatchObject({ e164: pick!.e164 });
    const view = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/numbers`,
      headers: as(biz.cookie),
    });
    expect(view.json()).toMatchObject({
      allowance: { included: 1, used: 1 },
      numbers: [{ e164: pick!.e164, billing: "included", status: "active" }],
    });

    // The plan's number is used: another one must be a paid extra.
    const second = await h.app.inject({
      method: "POST",
      url: `/api/tenants/${biz.tenantId}/numbers/orders`,
      headers: as(biz.cookie),
      payload: { type: "local", e164: fresh(), kind: "included" },
    });
    expect(second.json()).toMatchObject({ error: "INCLUDED_USED" });
  });

  it("an extra number goes on the bill first, needs the password, and comes off again", async () => {
    const biz = await paidBusiness("Extra Lines Co");
    await h.app.inject({
      method: "POST",
      url: `/api/tenants/${biz.tenantId}/numbers/identity`,
      headers: as(biz.cookie),
      payload: DETAILS,
    });
    const payload = { type: "local", e164: fresh(), kind: "extra" };
    const url = `/api/tenants/${biz.tenantId}/numbers/orders`;
    const noPassword = await h.app.inject({
      method: "POST",
      url,
      headers: as(biz.cookie),
      payload,
    });
    expect(noPassword.json()).toMatchObject({ error: "REAUTH_REQUIRED" });
    await reauth(h, biz.cookie);
    const ordered = await h.app.inject({ method: "POST", url, headers: as(biz.cookie), payload });
    expect(ordered.statusCode).toBe(201);
    expect(billing.addOns.at(-1)).toEqual({
      subscriptionId: biz.sub.id,
      priceId: PRICES.number_local,
      quantity: 1,
    });
    const view = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/numbers`,
      headers: as(biz.cookie),
    });
    expect(view.json()).toMatchObject({ allowance: { included: 1, extra: 1, total: 2 } });

    const { id } = ordered.json<{ id: string }>();
    const cancelled = await h.app.inject({
      method: "DELETE",
      url: `/api/tenants/${biz.tenantId}/numbers/orders/${id}`,
      headers: as(biz.cookie),
    });
    expect(cancelled.statusCode).toBe(204);
    expect(billing.addOns.at(-1)).toMatchObject({ priceId: PRICES.number_local, quantity: 0 });
  });

  it("buys nothing while purchases are switched off, or past the daily limit", async () => {
    const biz = await paidBusiness("Switch Co");
    await h.app.inject({
      method: "POST",
      url: `/api/tenants/${biz.tenantId}/numbers/identity`,
      headers: as(biz.cookie),
      payload: DETAILS,
    });
    const [identityId] = [...carrier.identities.keys()].slice(-1);
    carrier.decide(identityId!, "approved");
    await h.app.inject({
      method: "POST",
      url: `/api/tenants/${biz.tenantId}/numbers/orders`,
      headers: as(biz.cookie),
      payload: { type: "local", e164: fresh(), kind: "included" },
    });
    const deps = { db: h.db, carrier, sip, voiceUrl: "v", log };
    const off = await processNumberOrders(
      { ...deps, settings: { ...settings, autoBuy: false } },
      new Date(),
      [biz.tenantId],
    );
    expect(off.bought).toBe(0);
    const full = await processNumberOrders(
      { ...deps, settings: { ...settings, dailyLimit: 0 } },
      new Date(),
      [biz.tenantId],
    );
    expect(full.bought).toBe(0);
  });

  it("picks a nearby number when the chosen one has gone", async () => {
    const biz = await paidBusiness("Nearby Co");
    await h.app.inject({
      method: "POST",
      url: `/api/tenants/${biz.tenantId}/numbers/identity`,
      headers: as(biz.cookie),
      payload: DETAILS,
    });
    const [identityId] = [...carrier.identities.keys()].slice(-1);
    carrier.decide(identityId!, "approved");
    const gone = fresh();
    carrier.taken.add(gone);
    await h.app.inject({
      method: "POST",
      url: `/api/tenants/${biz.tenantId}/numbers/orders`,
      headers: as(biz.cookie),
      payload: { type: "local", e164: gone, area: "023", kind: "included" },
    });
    const pass = await processNumberOrders(
      { db: h.db, carrier, sip, voiceUrl: "v", log, settings },
      new Date(),
      [biz.tenantId],
    );
    expect(pass.bought).toBe(1);
    const [order] = await withPlatformAccess(h.db, { actorUserId: null, reason: "test" }, (tx) =>
      tx.select().from(numberOrders).where(eq(numberOrders.tenantId, biz.tenantId)),
    );
    expect(order).toMatchObject({ status: "active" });
    expect(order?.e164).not.toBe(gone);
  });

  it("when the plan stops paying, numbers switch off and are released 30 days later", async () => {
    const biz = await paidBusiness("Lapsed Co");
    await h.app.inject({
      method: "POST",
      url: `/api/tenants/${biz.tenantId}/numbers/identity`,
      headers: as(biz.cookie),
      payload: DETAILS,
    });
    const [identityId] = [...carrier.identities.keys()].slice(-1);
    carrier.decide(identityId!, "approved");
    await h.app.inject({
      method: "POST",
      url: `/api/tenants/${biz.tenantId}/numbers/orders`,
      headers: as(biz.cookie),
      payload: { type: "local", e164: fresh(), kind: "included" },
    });
    const deps = { db: h.db, carrier, sip, voiceUrl: "v", log, settings };
    await processNumberOrders(deps, new Date(), [biz.tenantId]);

    // Stripe cancels the subscription.
    biz.sub.status = "canceled";
    const body = JSON.stringify({
      id: `evt_cancel_${biz.sub.id}`,
      kind: "subscription_changed",
      subscriptionId: biz.sub.id,
    });
    await h.app.inject({
      method: "POST",
      url: "/api/webhooks/stripe",
      headers: { "content-type": "application/json", "stripe-signature": MockBilling.sign(body) },
      payload: body,
    });
    const now = new Date();
    expect((await processNumberOrders(deps, now, [biz.tenantId])).disabled).toBe(1);
    const later = new Date(now.getTime() + 31 * 86_400_000);
    const pass = await processNumberOrders(deps, later, [biz.tenantId]);
    expect(pass.released).toBe(1);
    const left = await withPlatformAccess(h.db, { actorUserId: null, reason: "test" }, (tx) =>
      tx.select().from(phoneNumbers).where(eq(phoneNumbers.tenantId, biz.tenantId)),
    );
    expect(left).toEqual([]);
    expect(carrier.released.length).toBeGreaterThan(0);
  });
});
