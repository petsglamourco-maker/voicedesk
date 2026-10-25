import { allowanceFor } from "@voicedesk/agent-brain";
import { MockBilling, type BillingSubscription } from "@voicedesk/adapters";
import { getPlanState, PLANS } from "@voicedesk/core";
import { auditLog, subscriptions, withPlatformAccess } from "@voicedesk/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHarness,
  createOwnerWithTenant,
  makePlatformOwner,
  ORIGIN,
  reauth,
  signUpVerified,
  type TestHarness,
} from "./harness";

const PRICES = { starter: "price_starter", growth: "price_growth", pro: "price_pro" };
const billing = new MockBilling();
let h: TestHarness;
let platform: { email: string; cookie: string };

beforeAll(async () => {
  h = await createHarness({ billing, billingPrices: PRICES });
  platform = await signUpVerified(h, "BillingPlatform");
  await makePlatformOwner(h, platform);
});
afterAll(() => h.close());

const as = (cookie: string) => ({ cookie, origin: ORIGIN });
let eventNo = 0;

async function webhook(event: object, signature?: string) {
  const body = JSON.stringify({ id: `evt_${Date.now()}_${++eventNo}`, ...event });
  return h.app.inject({
    method: "POST",
    url: "/api/webhooks/stripe",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature ?? MockBilling.sign(body),
    },
    payload: body,
  });
}

function stripeSub(tenantId: string, over: Partial<BillingSubscription> = {}) {
  const sub: BillingSubscription = {
    id: `sub_${tenantId.slice(0, 8)}`,
    customerId: `cus_${tenantId.slice(0, 8)}`,
    tenantId,
    priceId: PRICES.growth,
    status: "active",
    currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    cancelAtPeriodEnd: false,
    ...over,
  };
  billing.subscriptions.set(sub.id, sub);
  return sub;
}

async function paidFor(tenantId: string, over: Partial<BillingSubscription> = {}) {
  const sub = stripeSub(tenantId, over);
  const res = await webhook({
    kind: "checkout_completed",
    tenantId,
    customerId: sub.customerId,
    subscriptionId: sub.id,
  });
  expect(res.statusCode).toBe(200);
  return sub;
}

async function setPlan(tenantId: string, planId: string) {
  const res = await h.app.inject({
    method: "PUT",
    url: `/api/platform/tenants/${tenantId}/plan`,
    headers: as(platform.cookie),
    payload: { planId },
  });
  expect(res.statusCode).toBe(200);
}

describe("plan and billing page", () => {
  it("a new business starts on the 14-day trial", async () => {
    const biz = await createOwnerWithTenant(h, "Trial Co");
    const res = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/billing`,
      headers: as(biz.cookie),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      plan: { id: string };
      status: string;
      trialEndsAt: string;
      billingReady: boolean;
      canManage: boolean;
      plans: Array<{ id: string; available: boolean }>;
    }>();
    expect(body).toMatchObject({ status: "trialing", billingReady: true, canManage: true });
    expect(body.plan.id).toBe("trial");
    const days = (new Date(body.trialEndsAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(body.plans.map((p) => p.id)).toEqual(["starter", "growth", "pro"]);
  });

  it("checkout: owners only, after a password check, with the server's price", async () => {
    const biz = await createOwnerWithTenant(h, "Checkout Co");
    const url = `/api/tenants/${biz.tenantId}/billing/checkout`;
    const before = await h.app.inject({
      method: "POST",
      url,
      headers: as(biz.cookie),
      payload: { planId: "growth" },
    });
    expect(before.json()).toMatchObject({ error: "REAUTH_REQUIRED" });
    await reauth(h, biz.cookie);
    // The client names a plan, never a price.
    const bad = await h.app.inject({
      method: "POST",
      url,
      headers: as(biz.cookie),
      payload: { planId: "trial", priceId: "price_cheap" },
    });
    expect(bad.statusCode).toBe(400);
    const res = await h.app.inject({
      method: "POST",
      url,
      headers: as(biz.cookie),
      payload: { planId: "growth", priceId: "price_cheap" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ url: string }>().url).toMatch(/^https:\/\/billing\.mock\/checkout\//);
    expect(billing.checkouts.at(-1)).toMatchObject({
      tenantId: biz.tenantId,
      priceId: PRICES.growth,
      customerEmail: biz.email,
    });

    // A business member who isn't the owner can't buy.
    const other = await createOwnerWithTenant(h, "Other Co");
    const outsider = await h.app.inject({
      method: "POST",
      url,
      headers: as(other.cookie),
      payload: { planId: "growth" },
    });
    expect(outsider.statusCode).toBe(404);
  });
});

describe("Stripe webhook", () => {
  it("refuses unsigned or edited events", async () => {
    const res = await webhook({ kind: "ignored", type: "x" }, "bad");
    expect(res.statusCode).toBe(400);
  });

  it("a completed checkout moves the business onto the plan, once", async () => {
    const biz = await createOwnerWithTenant(h, "Paid Co");
    const sub = stripeSub(biz.tenantId, { priceId: PRICES.pro });
    const body = JSON.stringify({
      id: `evt_once_${biz.tenantId}`,
      kind: "checkout_completed",
      tenantId: biz.tenantId,
      customerId: sub.customerId,
      subscriptionId: sub.id,
    });
    const send = () =>
      h.app.inject({
        method: "POST",
        url: "/api/webhooks/stripe",
        headers: { "content-type": "application/json", "stripe-signature": MockBilling.sign(body) },
        payload: body,
      });
    expect((await send()).statusCode).toBe(200);
    const state = await getPlanState(h.db, biz.tenantId);
    expect(state).toMatchObject({ status: "active", usable: true });
    expect(state.plan.id).toBe("pro");
    expect(state.subscription).toMatchObject({
      stripeCustomerId: sub.customerId,
      stripeSubscriptionId: sub.id,
      trialEndsAt: null,
    });
    const settings = await allowanceFor(h.db, biz.tenantId);
    expect(settings.ai).toBe(PLANS.pro.aiPence);

    // Delivered again: nothing changes and nothing is audited twice.
    expect((await send()).statusCode).toBe(200);
    const audits = await withPlatformAccess(h.db, { actorUserId: null, reason: "test" }, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.tenantId, biz.tenantId), eq(auditLog.action, "billing.plan_changed")),
        ),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorType: "system" });
  });

  it("follows Stripe's latest state: past due keeps working for the grace, then stops", async () => {
    const biz = await createOwnerWithTenant(h, "Late Co");
    const sub = await paidFor(biz.tenantId);
    // Payment fails: Stripe marks the subscription past due.
    stripeSub(biz.tenantId, { status: "past_due" });
    await webhook({ kind: "subscription_changed", subscriptionId: sub.id, tenantId: null });
    const late = await getPlanState(h.db, biz.tenantId);
    expect(late).toMatchObject({ status: "past_due", usable: true });
    const since = late.subscription!.pastDueSince!;
    // Eight days later it's no longer usable: the AI takes messages, data stays.
    const later = await getPlanState(
      h.db,
      biz.tenantId,
      new Date(since.getTime() + 8 * 86_400_000),
    );
    expect(later).toMatchObject({ usable: false, reason: "unpaid" });

    // Paid again.
    stripeSub(biz.tenantId, { status: "active" });
    await webhook({ kind: "subscription_changed", subscriptionId: sub.id, tenantId: null });
    expect(await getPlanState(h.db, biz.tenantId)).toMatchObject({ status: "active" });
    expect((await getPlanState(h.db, biz.tenantId)).subscription!.pastDueSince).toBeNull();

    // Cancelled: nothing more is allowed, but the business can buy again.
    stripeSub(biz.tenantId, { status: "canceled" });
    await webhook({ kind: "subscription_changed", subscriptionId: sub.id, tenantId: null });
    expect(await getPlanState(h.db, biz.tenantId)).toMatchObject({
      usable: false,
      reason: "canceled",
    });
    expect(await allowanceFor(h.db, biz.tenantId)).toEqual({ ai: 0, sms: 0, calls: 0 });
  });

  it("can't move one business's subscription onto another", async () => {
    const a = await createOwnerWithTenant(h, "Owner A");
    const b = await createOwnerWithTenant(h, "Owner B");
    const sub = stripeSub(a.tenantId);
    await webhook({
      kind: "checkout_completed",
      tenantId: b.tenantId,
      customerId: sub.customerId,
      subscriptionId: sub.id,
    });
    expect((await getPlanState(h.db, b.tenantId)).plan.id).toBe("trial");
  });

  it("ignores prices that aren't one of our plans", async () => {
    const biz = await createOwnerWithTenant(h, "Odd Price Co");
    await paidFor(biz.tenantId, { priceId: "price_someone_made_up" });
    expect((await getPlanState(h.db, biz.tenantId)).plan.id).toBe("trial");
  });
});

describe("plan limits", () => {
  it("Starter has no WhatsApp, VA console or AI calls", async () => {
    const biz = await createOwnerWithTenant(h, "Starter Co");
    await setPlan(biz.tenantId, "starter");
    const wa = await h.app.inject({
      method: "POST",
      url: "/api/platform/whatsapp-numbers",
      headers: as(platform.cookie),
      payload: {
        tenantId: biz.tenantId,
        phoneNumberId: "123456789",
        displayNumber: "+447700900123",
      },
    });
    expect(wa.statusCode).toBe(402);
    expect(wa.json()).toMatchObject({ error: "PLAN_FEATURE" });
    const va = await h.app.inject({
      method: "POST",
      url: "/api/platform/vas",
      headers: as(platform.cookie),
      payload: { email: biz.email, tenantId: biz.tenantId },
    });
    expect(va.statusCode).toBe(402);
    const current = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/agent`,
      headers: as(biz.cookie),
    });
    const agent = await h.app.inject({
      method: "PUT",
      url: `/api/tenants/${biz.tenantId}/agent`,
      headers: as(biz.cookie),
      payload: { ...current.json<{ settings: object }>().settings, aiCallbacks: true },
    });
    expect(agent.json()).toMatchObject({ error: "PLAN_FEATURE" });
    expect(agent.statusCode).toBe(402);
  });

  it("invitations stop at the plan's team size (pending ones count)", async () => {
    const biz = await createOwnerWithTenant(h, "Seats Co");
    await setPlan(biz.tenantId, "starter"); // 3 seats
    const invite = async () =>
      h.app.inject({
        method: "POST",
        url: "/api/auth/organization/invite-member",
        headers: as(biz.cookie),
        payload: {
          email: `seat-${Math.random().toString(36).slice(2)}@example.com`,
          role: "staff",
          organizationId: biz.tenantId,
        },
      });
    expect((await invite()).statusCode).toBe(200);
    expect((await invite()).statusCode).toBe(200);
    const over = await invite();
    expect(over.statusCode).toBe(402);
    expect(over.json()).toMatchObject({ error: "PLAN_LIMIT" });
  });

  it("only the platform owner can give a plan", async () => {
    const biz = await createOwnerWithTenant(h, "Self Comp Co");
    const res = await h.app.inject({
      method: "PUT",
      url: `/api/platform/tenants/${biz.tenantId}/plan`,
      headers: as(biz.cookie),
      payload: { planId: "pro" },
    });
    expect(res.statusCode).toBe(404);
    // The business's own database login can't write its subscription either (RLS).
    await expect(
      h.db
        .update(subscriptions)
        .set({ planId: "pro" })
        .where(eq(subscriptions.tenantId, biz.tenantId))
        .returning(),
    ).resolves.toEqual([]);
  });
});
