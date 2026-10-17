import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  inet,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

/**
 * VoiceDesk application tables.
 *
 * Every tenant-owned table has a non-null `tenant_id` and is protected by a Row-Level
 * Security policy (see migrations/*_rls.sql). Never add a tenant table without adding
 * it to the RLS migration and to test/tenant-isolation.test.ts.
 */

const citext = customType<{ data: string }>({ dataType: () => "citext" });

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const tenantStatus = pgEnum("tenant_status", ["onboarding", "active", "suspended"]);

/** Business profile for a tenant. 1:1 with Better Auth `organization` (same id). */
export const tenants = pgTable("tenants", {
  id: uuid("id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  countryCode: text("country_code").notNull(), // ISO 3166-1 alpha-2, e.g. "GB"
  timezone: text("timezone").notNull(), // IANA, e.g. "Europe/London"
  defaultLanguage: text("default_language").notNull().default("en"), // BCP 47
  dataRegion: text("data_region").notNull().default("uk"),
  status: tenantStatus("status").notNull().default("onboarding"),
  ...timestamps,
});

/** Minimal contact record; extended into the mini-CRM in Phase 3. */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    fullName: text("full_name"),
    email: citext("email"),
    phoneE164: text("phone_e164"),
    /** Where the contact came from, e.g. "assistant" for sign-ups taken by the AI. */
    source: text("source"),
    /** What they're interested in (service / programme). */
    interest: text("interest"),
    /** Consent to marketing messages (PECR); service messages don't need it. */
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    /** Reference given to the customer when the assistant signed them up. */
    reference: text("reference"),
    ...timestamps,
  },
  (t) => [
    index("contacts_tenant_idx").on(t.tenantId),
    uniqueIndex("contacts_tenant_phone_uq")
      .on(t.tenantId, t.phoneE164)
      .where(sql`${t.phoneE164} is not null`),
  ],
);

/** Human VAs assigned to work for a tenant (used by the VA console, Phase 5). */
export const vaAssignments = pgTable(
  "va_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("va_assignments_tenant_user_uq").on(t.tenantId, t.userId)],
);

export const auditActorType = pgEnum("audit_actor_type", [
  "user",
  "platform_owner",
  "ai",
  "system",
]);

/**
 * Append-only audit log. UPDATE/DELETE are revoked from the app role and blocked by a
 * trigger. `tenant_id` is null for platform-level events.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    // Deliberately no FK: audit history must survive tenant deletion untouched.
    tenantId: uuid("tenant_id"),
    actorType: auditActorType("actor_type").notNull(),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(), // e.g. "tenant.created", "member.invited"
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: inet("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_tenant_created_idx").on(t.tenantId, t.createdAt)],
);
