import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts, tenants, timestamps } from "./app";

/** Per-tenant agent configuration (persona, languages). See @voicedesk/agent-brain. */
export const agentSettings = pgTable("agent_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  personaId: text("persona_id").notNull().default("amelia"),
  /** Custom display names per persona id, e.g. { amelia: "Ellie" }. */
  personaNames: jsonb("persona_names").$type<Record<string, string>>().notNull().default({}),
  enabledLanguages: text("enabled_languages")
    .array()
    .notNull()
    .default(["en", "es", "zh", "fr", "ar", "de"]),
  /** Language summaries and notifications are written in. */
  adminLanguage: text("admin_language").notNull().default("en"),
  /** Record calls (adds a spoken recording notice). Transcripts are always kept. */
  recordCalls: boolean("record_calls").notNull().default(false),
  /** Optional TTS voice id per persona, overriding the defaults. */
  voiceIds: jsonb("voice_ids").$type<Record<string, string>>().notNull().default({}),
  ...timestamps,
});

export const conversationChannel = pgEnum("conversation_channel", [
  "test_console",
  "web_chat",
  "voice",
  "whatsapp",
  "sms",
  "email",
]);
export const conversationStatus = pgEnum("conversation_status", ["active", "ended"]);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    channel: conversationChannel("channel").notNull(),
    /** "voice" style rules (short, spoken) or "chat". */
    style: text("style").notNull().default("chat"),
    personaId: text("persona_id").notNull(),
    language: text("language").notNull(),
    status: conversationStatus("status").notNull().default("active"),
    /** Engine state snapshot (flow, step, captured slots, LLM history). */
    state: jsonb("state").$type<Record<string, unknown>>().notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    createdBy: uuid("created_by"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("conversations_tenant_started_idx").on(t.tenantId, t.startedAt)],
);

export const messageRole = pgEnum("conversation_message_role", ["caller", "agent", "event"]);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    language: text("language"),
    /** Tool calls, latency (ms), token usage, flow step. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversation_messages_conversation_idx").on(t.conversationId, t.id)],
);

export const ticketStatus = pgEnum("ticket_status", ["open", "in_progress", "resolved", "closed"]);
export const ticketPriority = pgEnum("ticket_priority", ["low", "normal", "high", "urgent"]);

/** Complaints and issues captured by the agent (or staff). */
export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    category: text("category").notNull().default("complaint"),
    status: ticketStatus("status").notNull().default("open"),
    priority: ticketPriority("priority").notNull().default("normal"),
    /** Structured complaint fields captured in the conversation. */
    details: jsonb("details").$type<Record<string, unknown>>().notNull(),
    callbackPhone: text("callback_phone"),
    callbackEmail: text("callback_email"),
    callbackTime: text("callback_time"),
    contactConsent: boolean("contact_consent").notNull().default(false),
    summary: text("summary"),
    ...timestamps,
  },
  (t) => [uniqueIndex("tickets_tenant_reference_uq").on(t.tenantId, t.reference)],
);

/** Messages taken for staff ("AI answering machine"). */
export const staffMessages = pgTable(
  "staff_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    callerName: text("caller_name").notNull(),
    callerPhone: text("caller_phone").notNull(),
    forStaff: text("for_staff"),
    reason: text("reason").notNull(),
    urgency: text("urgency").notNull().default("normal"),
    bestTime: text("best_time"),
    status: text("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("staff_messages_tenant_reference_uq").on(t.tenantId, t.reference)],
);

/** Native internal calendar. External calendar sync arrives in Phase 3. */
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    service: text("service").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone"),
    customerEmail: text("customer_email"),
    notes: text("notes"),
    status: text("status").notNull().default("confirmed"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("bookings_tenant_reference_uq").on(t.tenantId, t.reference),
    index("bookings_tenant_starts_idx").on(t.tenantId, t.startsAt),
  ],
);

/** Every LLM call's token usage and estimated cost (margin reporting, spend guard). */
export const llmUsage = pgTable(
  "llm_usage",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(), // "conversation.turn", "profile.generate", ...
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }).notNull(),
    conversationId: uuid("conversation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("llm_usage_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

/**
 * Questions the assistant couldn't answer from the profile or knowledge base. The business
 * adds the answer (e.g. as an FAQ) so the gap is closed without human callbacks.
 */
export const knowledgeGaps = pgTable(
  "knowledge_gaps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("open"), // open | resolved
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("knowledge_gaps_tenant_status_idx").on(t.tenantId, t.status)],
);
