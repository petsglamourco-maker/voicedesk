import {
  invitation,
  member,
  phoneNumbers,
  subscriptions,
  withTenant,
  type Database,
} from "@voicedesk/db";
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
  id: PlanId;
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
  const plan = PLANS[row && isPlanId(row.planId) ? row.planId : "trial"];
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

/** Refuses a new phone number beyond the plan's limit. */
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
  if (rows.length >= state.plan.phoneNumbers) {
    const n = state.plan.phoneNumbers;
    throw new PlanLimitError(
      "PLAN_LIMIT",
      `The ${state.plan.name} plan includes ${n} phone number${n === 1 ? "" : "s"}.`,
    );
  }
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
