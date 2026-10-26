import {
  integer,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./app";

/**
 * Instant demo (ADR 0029): a visitor's website becomes a short-lived demo business. One row
 * per demo business (tenant data under forced RLS); the business and everything in it is
 * deleted when the demo expires.
 */
export const demos = pgTable("demos", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  /** SHA-256 of the random half of the visitor's key ("<tenantId>.<random>"). */
  tokenHash: text("token_hash").notNull(),
  website: text("website").notNull(),
  /** crawling → building → ready | failed */
  status: text("status").notNull().default("crawling"),
  /** Short reason code when it failed (never page text). */
  error: text("error"),
  chatTurns: integer("chat_turns").notNull().default(0),
  voiceCalls: integer("voice_calls").notNull().default(0),
  /** The platform-side record (demo_requests) that outlives the demo. */
  requestId: uuid("request_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/**
 * Every demo, for the platform owner (Platform admin → Demos): counts, cost and the optional
 * lead email. Platform-only under RLS. Kept after the demo is deleted; the email is cleared
 * after 90 days.
 */
export const demoRequests = pgTable(
  "demo_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    website: text("website").notNull(),
    businessName: text("business_name"),
    /** Only with the visitor's ticked consent; cleared after 90 days or on request. */
    email: text("email"),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    /** SHA-256 of the visitor's IP with a server secret (abuse checks; never the IP). */
    ipHash: text("ip_hash"),
    status: text("status").notNull().default("crawling"),
    /** AI spend of the demo (USD), copied in when it's deleted. */
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    usage: jsonb("usage").$type<{ chatTurns: number; voiceCalls: number }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
  },
  (t) => [index("demo_requests_created_idx").on(t.createdAt)],
);
