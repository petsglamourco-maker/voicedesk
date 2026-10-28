import {
  invitation,
  member,
  phoneNumbers,
  subscriptions,
  withTenant,
  type Database,
} from "@voicedesk/db";
import type { Currency } from "@voicedesk/compliance";
import { and, eq, sql } from "drizzle-orm";

/**
 * Plans (ADR 0023). The plan alone decides what a business can use; when an allowance runs
 * out, the business is asked to upgrade. Prices were set from measured unit costs so every
 * plan stays profitable even when fully used (cost breakdown in the ADR). Prices are in pence,
 * excluding VAT. Stripe Price ids come from .env (STRIPE_PRICE_<PLAN>).
 */
export const PLAN_FEATURES = [
  "whatsapp",
  "va_console",
  "feedback",
  "daily_brief",
  "ai_calls",
  "departments",
  "follow_ups",
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

export const PLAN_IDS = ["trial", "starter", "growth", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export const PAID_PLANS = ["starter", "growth", "pro"] as const satisfies readonly PlanId[];
export type PaidPlanId = (typeof PAID_PLANS)[number];

export interface Plan {
  /** "demo": instant-demo businesses only (ADR 0029); never offered or assignable. */
  id: PlanId | "demo";
  name: string;
  /** Monthly price in pence, excluding VAT (0 for the trial). */
  pricePence: number;
  /** Monthly allowances. */
  minutes: number;
  texts: number;
  aiPence: number;
  /** Limits. */
  phoneNumbers: number;
  seats: number;
  features: readonly PlanFeature[];
}

const ALL_FEATURES = PLAN_FEATURES;

export const PLANS: Record<PlanId, Plan> = {
  // 14 days, every feature, small allowances: try everything, at little cost.
  trial: {
    id: "trial",
    name: "Free trial",
    pricePence: 0,
    minutes: 20,
    texts: 10,
    aiPence: 100,
    phoneNumbers: 1,
    seats: 3,
    features: ALL_FEATURES,
  },
  starter: {
    id: "starter",
    name: "Starter",
    pricePence: 2900,
    minutes: 100,
    texts: 60,
    aiPence: 400,
    phoneNumbers: 1,
    seats: 3,
    features: [],
  },
  growth: {
    id: "growth",
    name: "Growth",
    pricePence: 7900,
    minutes: 350,
    texts: 200,
    aiPence: 1000,
    phoneNumbers: 1,
    seats: 8,
    features: ALL_FEATURES,
  },
  pro: {
    id: "pro",
    name: "Pro",
    pricePence: 21900,
    minutes: 1000,
    texts: 600,
    aiPence: 2500,
    phoneNumbers: 2,
    seats: 25,
    features: ALL_FEATURES,
  },
};

/**
 * ADR 0029: instant-demo businesses. Nothing can leave them: no texts, no outbound calls, no
 * paid features; a small AI allowance and a few voice minutes. Not in PLAN_IDS, so it can
 * never be bought, listed or given from Platform admin.
 */
export const DEMO_PLAN: Plan = {
  id: "demo",
  name: "Demo",
  pricePence: 0,
  minutes: 10,
  texts: 0,
  aiPence: 40,
  phoneNumbers: 0,
  seats: 0,
  features: [],
};

/** ADR 0031: what businesses pay in each country's currency. */
export const CURRENCIES = [
  "GBP",
  "EUR",
  "USD",
  "CAD",
  "AUD",
  "NZD",
] as const satisfies readonly Currency[];

/**
 * Monthly prices in minor units (pence, cents), excluding VAT/GST/sales tax. GBP matches
 * `pricePence`. Set from measured unit costs (ADR 0031): carrier minutes in the US and
 * Canada cost less than in the UK, so every currency stays profitable.
 */
export const PLAN_PRICES: Record<PaidPlanId, Record<Currency, number>> = {
  starter: { GBP: 2900, EUR: 3500, USD: 3900, CAD: 4900, AUD: 5900, NZD: 6500 },
  growth: { GBP: 7900, EUR: 8900, USD: 9900, CAD: 12900, AUD: 14900, NZD: 15900 },
  pro: { GBP: 21900, EUR: 24900, USD: 27900, CAD: 35900, AUD: 39900, NZD: 42900 },
};

/**
 * ADR 0032: extra phone numbers, per month on top of the plan, in minor units excluding tax.
 * Carrier cost is about £0.87 (local) and £1.89 (mobile) a month, plus minutes.
 */
export const NUMBER_PRICES: Record<"local" | "mobile", Record<Currency, number>> = {
  local: { GBP: 500, EUR: 600, USD: 700, CAD: 900, AUD: 1000, NZD: 1100 },
  mobile: { GBP: 800, EUR: 900, USD: 1100, CAD: 1400, AUD: 1500, NZD: 1700 },
};

export function planPrice(planId: PaidPlanId, currency: Currency): number {
  return PLAN_PRICES[planId][currency];
}

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

export const TRIAL_DAYS = 14;
/** After a failed payment, the plan keeps working this long before AI pauses. */
export const PAST_DUE_GRACE_DAYS = 7;

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}

export type SubscriptionRow = typeof subscriptions.$inferSelect;

export interface PlanState {
  plan: Plan;
  status: "trialing" | "active" | "past_due" | "canceled";
  /** False when the plan can't be used: trial ended, cancelled, or unpaid past the grace. */
  usable: boolean;
  /** Why it isn't usable, for banners. */
  reason: "trial_ended" | "canceled" | "unpaid" | null;
  subscription: SubscriptionRow | null;
}

/** Interprets a subscription row (none yet = a trial that started now). */
export function planState(row: SubscriptionRow | null, now: Date = new Date()): PlanState {
  const plan =
    row?.planId === "demo" ? DEMO_PLAN : PLANS[row && isPlanId(row.planId) ? row.planId : "trial"];
  const status = (row?.status ?? "trialing") as PlanState["status"];
  let reason: PlanState["reason"] = null;
  if (status === "canceled") reason = "canceled";
  else if (status === "trialing" && row?.trialEndsAt && row.trialEndsAt < now) {
    reason = "trial_ended";
  } else if (
    status === "past_due" &&
    row?.pastDueSince &&
    now.getTime() - row.pastDueSince.getTime() > PAST_DUE_GRACE_DAYS * 86_400_000
  ) {
    reason = "unpaid";
  }
  return { plan, status, usable: reason === null, reason, subscription: row };
}

export async function getPlanState(
  db: Database,
  tenantId: string,
  now: Date = new Date(),
): Promise<PlanState> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)),
  );
  return planState(row ?? null, now);
}

export function planAllows(state: PlanState, feature: PlanFeature): boolean {
  return state.usable && state.plan.features.includes(feature);
}

export class PlanLimitError extends Error {
  constructor(
    readonly code: "PLAN_FEATURE" | "PLAN_LIMIT" | "PLAN_INACTIVE",
    message: string,
  ) {
    super(message);
    this.name = "PlanLimitError";
  }
}

const FEATURE_NAMES: Record<PlanFeature, string> = {
  whatsapp: "WhatsApp",
  va_console: "the VA console and people answering calls",
  feedback: "customer feedback surveys",
  daily_brief: "the daily brief",
  ai_calls: "AI callbacks and confirmation calls",
  departments: "departments and the phone menu",
  follow_ups: "follow-ups after enquiries",
};

/** Throws a PlanLimitError (API: 402) when the plan doesn't include the feature. */
export async function requireFeature(
  db: Database,
  tenantId: string,
  feature: PlanFeature,
): Promise<void> {
  const state = await getPlanState(db, tenantId);
  if (!state.usable) {
    throw new PlanLimitError(
      "PLAN_INACTIVE",
      "Your plan isn't active. See Settings → Plan & billing.",
    );
  }
  if (!state.plan.features.includes(feature)) {
    throw new PlanLimitError(
      "PLAN_FEATURE",
      `${FEATURE_NAMES[feature]} isn't included in the ${state.plan.name} plan. Upgrade in Settings → Plan & billing.`,
    );
  }
}

/** Creates the trial for a new business (inside its own tenant transaction). */
export function trialValues(tenantId: string, now: Date = new Date()) {
  return {
    tenantId,
    planId: "trial",
    status: "trialing",
    trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 86_400_000),
  } as const;
}

/** How many numbers a business may have: the plan's, plus extras paid for (ADR 0032). */
export function numberAllowance(state: PlanState): {
  included: number;
  extra: number;
  total: number;
} {
  const paid = state.subscription?.extraNumbers ?? { local: 0, mobile: 0 };
  const extra = Math.max(0, paid.local) + Math.max(0, paid.mobile);
  return { included: state.plan.phoneNumbers, extra, total: state.plan.phoneNumbers + extra };
}

/** Refuses a new phone number beyond the plan's numbers plus the paid extras. */
export async function requireNumberSlot(db: Database, tenantId: string): Promise<void> {
  const state = await getPlanState(db, tenantId);
  if (!state.usable) {
    throw new PlanLimitError("PLAN_INACTIVE", "This business's plan isn't active.");
  }
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ id: phoneNumbers.id })
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.status, "active"))),
  );
  const allowance = numberAllowance(state);
  if (rows.length >= allowance.total) {
    const n = state.plan.phoneNumbers;
    throw new PlanLimitError(
      "PLAN_LIMIT",
      `The ${state.plan.name} plan includes ${n} phone number${n === 1 ? "" : "s"}` +
        (allowance.extra
          ? ` and you pay for ${allowance.extra} more.`
          : ". Add an extra number to get more."),
    );
  }
}

/** ADR 0032: numbers are bought only for businesses on a paid plan that's in good standing. */
export async function requirePaidPlan(db: Database, tenantId: string): Promise<PlanState> {
  const state = await getPlanState(db, tenantId);
  if (!state.usable || state.plan.id === "trial" || state.plan.id === "demo") {
    throw new PlanLimitError(
      "PLAN_FEATURE",
      "Your own phone number comes with a paid plan. Until then, forward your existing number or try the assistant in the test console.",
    );
  }
  return state;
}

/** Refuses an invitation when members plus pending invitations reach the plan's seats. */
export async function requireSeat(db: Database, tenantId: string): Promise<void> {
  const state = await getPlanState(db, tenantId);
  const [members] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(member)
    .where(eq(member.organizationId, tenantId));
  const [pending] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(invitation)
    .where(and(eq(invitation.organizationId, tenantId), eq(invitation.status, "pending")));
  if ((members?.n ?? 0) + (pending?.n ?? 0) >= state.plan.seats) {
    throw new PlanLimitError(
      "PLAN_LIMIT",
      `The ${state.plan.name} plan includes ${state.plan.seats} team members (including pending invitations).`,
    );
  }
}
