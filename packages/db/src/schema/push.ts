import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { session, user } from "./auth";

/**
 * Phones and browsers that get push notifications (ADR 0024). Per person and per sign-in:
 * signing out or revoking that session deletes the row (cascade). The subscription (push
 * endpoint and keys) is stored encrypted with SecretBox; only its hash is searchable.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    /** SHA-256 of the endpoint, to find or replace a subscription. */
    endpointHash: text("endpoint_hash").notNull(),
    /** SecretBox ciphertext of { endpoint, keys }. */
    subscription: text("subscription").notNull(),
    /** "Chrome on Android"; no identifiers. */
    deviceLabel: text("device_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_uq").on(t.endpointHash)],
);
