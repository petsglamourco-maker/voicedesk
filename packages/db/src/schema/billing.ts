import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants, timestamps } from "./app";

/**
 * Each business's plan (ADR 0023). A business may only create its own trial row; every
 * other change comes from the Stripe webhook or Platform admin through the platform login.
 * RLS in migrations (custom SQL).
 */
export const subscriptions = pgTable("subscriptions", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  /** "trial" | "starter" | "growth" | "pro" (packages/core/src/plans.ts). */
  planId: text("plan_id").notNull(),
  /** trialing | active | past_due | canceled */
  status: text("status").notNull(),
  /** Given free by the platform owner (no Stripe subscription). */
  comped: boolean("comped").notNull().default(false),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  /** When payment first failed (past_due grace starts here). */
  pastDueSince: timestamp("past_due_since", { withTimezone: true }),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  ...timestamps,
});

/** Stripe webhook events already handled (Stripe can deliver the same event again). */
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});
