import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid, index } from "drizzle-orm/pg-core";
import { tenants, timestamps } from "./app";
import { phoneNumbers } from "./conversations";

/**
 * Automatic phone numbers (ADR 0032). The carrier reviews each business once (an "identity":
 * Twilio's regulatory bundle); numbers are then bought under it by the workers. Tenant data
 * under forced RLS. The submitted details are personal data, kept only for the review.
 */
export const numberIdentities = pgTable(
  "number_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    carrier: text("carrier").notNull().default("twilio"),
    /** "local" or "mobile": carriers review each number type separately. */
    numberType: text("number_type").notNull().default("local"),
    /** The carrier's review id (Twilio bundle sid) and address id. */
    carrierIdentityId: text("carrier_identity_id"),
    carrierAddressId: text("carrier_address_id"),
    /** pending → approved | rejected */
    status: text("status").notNull().default("pending"),
    reason: text("reason"),
    /** What was submitted (shown back to the owner; never logged). */
    details: jsonb("details").$type<Record<string, unknown>>().notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("number_identities_tenant_type_uq").on(t.tenantId, t.numberType)],
);

/** A number a business asked for, bought once its review is approved (ADR 0032). */
export const numberOrders = pgTable(
  "number_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    numberType: text("number_type").notNull().default("local"),
    /** "included" in the plan, or a paid "extra" number. */
    kind: text("kind").notNull().default("included"),
    /** The number picked from the search (another nearby one if it's gone by then). */
    e164: text("e164").notNull(),
    /** Area code or town, to find a nearby replacement. */
    area: text("area"),
    label: text("label"),
    /** waiting_review → buying → active | failed | cancelled */
    status: text("status").notNull().default("waiting_review"),
    reason: text("reason"),
    phoneNumberId: uuid("phone_number_id").references(() => phoneNumbers.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [index("number_orders_status_idx").on(t.status)],
);
