import type { BillingProvider, BillingSubscription } from "@voicedesk/adapters";
import type { Currency } from "@voicedesk/compliance";
import { CURRENCIES, isPlanId, PAID_PLANS, recordAudit, type PaidPlanId } from "@voicedesk/core";
import { subscriptions, tenants, withPlatformAccess, type Database } from "@voicedesk/db";
import { eq } from "drizzle-orm";

/**
 * Keeps `subscriptions` in step with Stripe (ADR 0023). Webhook events only say *which*
 * subscription changed; its latest state is fetched from Stripe, so retries and events that
 * arrive out of order always end in the current state. Writes use the platform login and
 * are audited as the system.
 */

/**
 * Stripe Price ids: "starter" (GBP, STRIPE_PRICE_STARTER) and "starter_usd" etc. for the other
 * currencies (STRIPE_PRICE_STARTER_USD), ADR 0031.
 */
export type PriceMap = Record<string, string>;

const priceKey = (plan: PaidPlanId, currency: Currency) =>
  currency === "GBP" ? plan : `${plan}_${currency.toLowerCase()}`;

export function priceIdFor(
  prices: PriceMap,
  plan: PaidPlanId,
  currency: Currency,
): string | undefined {
  return prices[priceKey(plan, currency)];
}

/** ADR 0032: the add-on price for an extra number of a type, in a currency. */
export function numberPriceIdFor(
  prices: PriceMap,
  type: "local" | "mobile",
  currency: Currency,
): string | undefined {
  return prices[`number_${type}${currency === "GBP" ? "" : `_${currency.toLowerCase()}`}`];
}

/** Extra numbers paid for on a subscription, from its add-on lines. */
export function extraNumbersOf(
  prices: PriceMap,
  items: Array<{ priceId: string; quantity: number }>,
): { local: number; mobile: number } {
  const extra = { local: 0, mobile: 0 };
  for (const item of items) {
    for (const type of ["local", "mobile"] as const) {
      for (const currency of CURRENCIES) {
        if (numberPriceIdFor(prices, type, currency) === item.priceId) extra[type] += item.quantity;
      }
    }
  }
  return extra;
}

export function planForPrice(prices: PriceMap, priceId: string | null): PaidPlanId | null {
  if (!priceId) return null;
  for (const plan of PAID_PLANS) {
    for (const currency of CURRENCIES) {
      if (prices[priceKey(plan, currency)] === priceId) return plan;
    }
  }
  return null;
}

export function toPriceMap(raw: Record<string, string> | undefined): PriceMap {
  const prices: PriceMap = {};
  const keys = [...PAID_PLANS, "number_local", "number_mobile"];
  for (const key of keys) {
    for (const currency of CURRENCIES) {
      const full = currency === "GBP" ? key : `${key}_${currency.toLowerCase()}`;
      if (raw?.[full]) prices[full] = raw[full];
    }
  }
  return prices;
}

type Status = "active" | "past_due" | "canceled";

/** Stripe's subscription status in our terms; null = not paid for yet, leave as is. */
export function statusFor(sub: Pick<BillingSubscription, "status">): Status | null {
  switch (sub.status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
    case "paused":
      return "canceled";
    default:
      return null; // incomplete: checkout not finished
  }
}

export interface SyncResult {
  outcome: "updated" | "ignored";
  reason?: string;
}

export async function syncSubscription(
  deps: { db: Database; billing: BillingProvider; prices: PriceMap },
  params: { subscriptionId: string; tenantId: string | null; customerId?: string | null },
  now: Date = new Date(),
): Promise<SyncResult> {
  const { db } = deps;
  const actor = { actorUserId: null, reason: "billing webhook" };
  const sub = await deps.billing.getSubscription(params.subscriptionId);
  if (!sub) return { outcome: "ignored", reason: "subscription not found" };

  return withPlatformAccess(db, actor, async (tx) => {
    // Which business: the one our checkout put in the metadata, or the one already linked.
    const [linked] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, sub.id));
    const tenantId = sub.tenantId ?? params.tenantId ?? linked?.tenantId ?? null;
    if (!tenantId) return { outcome: "ignored", reason: "no business" };
    if (
      (params.tenantId && sub.tenantId && params.tenantId !== sub.tenantId) ||
      (linked && linked.tenantId !== tenantId)
    ) {
      return { outcome: "ignored", reason: "business mismatch" };
    }
    const [tenant] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!tenant) return { outcome: "ignored", reason: "unknown business" };

    const [current] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId));
    // A business with its own customer can't be moved onto someone else's.
    if (current?.stripeCustomerId && current.stripeCustomerId !== sub.customerId) {
      return { outcome: "ignored", reason: "customer mismatch" };
    }
    // An older subscription ending doesn't cancel a newer one.
    if (
      current?.stripeSubscriptionId &&
      current.stripeSubscriptionId !== sub.id &&
      current.status !== "canceled" &&
      statusFor(sub) === "canceled"
    ) {
      return { outcome: "ignored", reason: "superseded subscription" };
    }
    const status = statusFor(sub);
    if (!status) return { outcome: "ignored", reason: `status ${sub.status}` };
    // The plan line is whichever line has a plan price (add-ons sit beside it, ADR 0032).
    const items = sub.items ?? (sub.priceId ? [{ priceId: sub.priceId, quantity: 1 }] : []);
    const plan =
      items.map((i) => planForPrice(deps.prices, i.priceId)).find((p) => p !== null) ??
      planForPrice(deps.prices, sub.priceId);
    if (!plan) return { outcome: "ignored", reason: "unknown price" };

    const values = {
      planId: plan,
      status,
      comped: false,
      trialEndsAt: null,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      pastDueSince: status === "past_due" ? (current?.pastDueSince ?? now) : null,
      stripeCustomerId: sub.customerId || params.customerId || null,
      stripeSubscriptionId: sub.id,
      extraNumbers:
        status === "canceled" ? { local: 0, mobile: 0 } : extraNumbersOf(deps.prices, items),
      updatedAt: now,
    };
    await tx
      .insert(subscriptions)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: subscriptions.tenantId, set: values });
    if (current?.planId !== plan || current?.status !== status) {
      await recordAudit(tx, {
        tenantId,
        actorType: "system",
        action: "billing.plan_changed",
        targetType: "subscription",
        targetId: tenantId,
        metadata: {
          from: current ? `${current.planId}/${current.status}` : null,
          to: `${plan}/${status}`,
        },
      });
    }
    return { outcome: "updated" };
  });
}

/** Platform admin: give a plan free, or put a business back on a trial of N days. */
export async function setPlanByPlatform(
  db: Database,
  actorUserId: string,
  params: { tenantId: string; planId: string; trialDays?: number; ipAddress?: string | null },
  now: Date = new Date(),
): Promise<boolean> {
  if (!isPlanId(params.planId)) return false;
  const trial = params.planId === "trial";
  const values = {
    planId: params.planId,
    status: trial ? "trialing" : "active",
    comped: !trial,
    trialEndsAt: trial ? new Date(now.getTime() + (params.trialDays ?? 14) * 86_400_000) : null,
    pastDueSince: null,
    updatedAt: now,
  };
  return withPlatformAccess(db, { actorUserId, reason: "set business plan" }, async (tx) => {
    const [tenant] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, params.tenantId));
    if (!tenant) return false;
    await tx
      .insert(subscriptions)
      .values({ tenantId: params.tenantId, ...values })
      .onConflictDoUpdate({ target: subscriptions.tenantId, set: values });
    await recordAudit(tx, {
      tenantId: params.tenantId,
      actorType: "platform_owner",
      actorUserId,
      action: "billing.plan_set",
      targetType: "subscription",
      targetId: params.tenantId,
      metadata: {
        planId: params.planId,
        comped: values.comped,
        trialDays: trial ? (params.trialDays ?? 14) : null,
      },
      ipAddress: params.ipAddress ?? null,
    });
    return true;
  });
}
