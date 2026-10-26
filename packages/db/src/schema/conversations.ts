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
  vector,
} from "drizzle-orm/pg-core";
import { contacts, tenants, timestamps } from "./app";
import { user } from "./auth";

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
  /** Hours before a booking to send the customer a reminder; 0 = no reminders. */
  reminderHours: integer("reminder_hours").notNull().default(24),
  /** Send customers a confirmation when a booking is made, moved or cancelled. */
  customerConfirmations: boolean("customer_confirmations").notNull().default(true),
  /** Mobile number that also gets urgent alerts by SMS (owners/admins always get email). */
  alertPhone: text("alert_phone"),
  /** Phone calls: number to put callers through to when they ask for a person (Phase 3). */
  transferPhone: text("transfer_phone"),
  /** When transfers to transferPhone are allowed: "open" (opening hours) or "always". */
  transferHours: text("transfer_hours").notNull().default("open"),
  /** Out-of-hours number for urgent situations only. */
  onCallPhone: text("on_call_phone"),
  /** What counts as urgent for this business (e.g. "burst pipe, no heating"). */
  urgentSituations: text("urgent_situations"),
  /**
   * Who a phone caller asking for a person reaches (Phase 5): "people_then_phone" (someone
   * at the VA console, else the transfer number), "people_only", or "phone_only".
   */
  handoffRoute: text("handoff_route").notNull().default("people_then_phone"),
  /** How long the VA console rings before falling back. */
  ringSeconds: integer("ring_seconds").notNull().default(30),
  /** Phase 6: ask customers how we did at the end of chats, WhatsApp and email (free). */
  feedbackEnabled: boolean("feedback_enabled").notNull().default(true),
  /** Phase 6: also text callers a rating link after phone calls (SMS costs money). */
  feedbackAfterCalls: boolean("feedback_after_calls").notNull().default(false),
  /** Phase 6: every Nth survey asks the NPS question instead (0 = never). */
  npsEvery: integer("nps_every").notNull().default(0),
  /** Phase 6: morning email to owners/admins with yesterday and today at a glance. */
  dailyBrief: boolean("daily_brief").notNull().default(true),
  /** Local date (YYYY-MM-DD) of the last brief, so each day's goes out once. */
  briefSentOn: text("brief_sent_on"),
  /** Phase 6: the assistant phones customers who asked to be called back (costs money). */
  aiCallbacks: boolean("ai_callbacks").notNull().default(false),
  /** Phase 6: the assistant phones to confirm bookings instead of the reminder text. */
  confirmationCalls: boolean("confirmation_calls").notNull().default(false),
  /** Phase 6: most AI outbound calls per day (a cost and courtesy limit). */
  outboundDailyCap: integer("outbound_daily_cap").notNull().default(20),
  /** Optional TTS voice id per persona, overriding the defaults. */
  voiceIds: jsonb("voice_ids").$type<Record<string, string>>().notNull().default({}),
  /**
   * Monthly spend caps in pence, chosen by the business within its allowance (security
   * batch 4, ADR 0022). AI: model costs; sms: texts; calls: voice minutes.
   */
  aiCapPence: integer("ai_cap_pence").notNull().default(2000),
  smsCapPence: integer("sms_cap_pence").notNull().default(1000),
  callsCapPence: integer("calls_cap_pence").notNull().default(2000),
  /** Staff and VAs who answer calls may also phone customers (owners/admins always can). */
  answerersCanCallOut: boolean("answerers_can_call_out").notNull().default(false),
  /** ADR 0025: the department menu after the greeting ("press 1 for Sales…"). */
  menuEnabled: boolean("menu_enabled").notNull().default(false),
  /** "always", or "open": outside opening hours the assistant answers directly. */
  menuHours: text("menu_hours").notNull().default("always"),
  /** Offer the same departments as buttons in website chat and a list in WhatsApp. */
  menuOnChat: boolean("menu_on_chat").notNull().default(false),
  /** "direct": VoiceDesk answers; "backup": the main line forwards here when unanswered. */
  callEntry: text("call_entry").notNull().default("direct"),
  /** Ring the people who answer calls first; the assistant answers when nobody does. */
  ringFirst: boolean("ring_first").notNull().default(false),
  /** ADR 0026: offer one follow-up after enquiries that didn't book (customer must agree). */
  followUps: boolean("follow_ups").notNull().default(false),
  ...timestamps,
});

export const phoneNumberStatus = pgEnum("phone_number_status", ["active", "disabled"]);

/**
 * Phone numbers routed to a business's assistant (Phase 2b, ADR 0013). Bought by the platform
 * owner (Twilio) and registered in Platform admin, which creates the LiveKit SIP inbound trunk
 * and dispatch rule. Businesses can read their own numbers; only platform access can write.
 */
export const phoneNumbers = pgTable(
  "phone_numbers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** E.164, e.g. +442071234567. Globally unique. */
    e164: text("e164").notNull(),
    provider: text("provider").notNull().default("twilio"),
    label: text("label"),
    status: phoneNumberStatus("status").notNull().default("active"),
    livekitTrunkId: text("livekit_trunk_id"),
    livekitDispatchRuleId: text("livekit_dispatch_rule_id"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("phone_numbers_e164_idx").on(t.e164),
    index("phone_numbers_tenant_idx").on(t.tenantId),
  ],
);

export const conversationChannel = pgEnum("conversation_channel", [
  "test_console",
  "web_chat",
  "voice",
  "whatsapp",
  "sms",
  "email",
  "web_form",
]);
export const conversationStatus = pgEnum("conversation_status", ["active", "ended"]);

/** Per-turn voice latency (ms): end of speech → turn committed → first text → first audio. */
export interface VoiceMetrics {
  turns: Array<{
    endOfUtteranceMs?: number;
    llmFirstTextMs?: number;
    ttsFirstByteMs?: number;
    totalMs?: number;
    filler?: boolean;
  }>;
  medianMs: number | null;
}

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
    /** Phone calls: the number that was called. */
    phoneNumberId: uuid("phone_number_id").references(() => phoneNumbers.id, {
      onDelete: "set null",
    }),
    /** Phone calls: the caller hid their number. */
    callerNumberWithheld: boolean("caller_number_withheld").notNull().default(false),
    /** Phone calls: "inbound", or "outbound" when someone at the VA console dialled out. */
    direction: text("direction").notNull().default("inbound"),
    /** Object-storage key of the call recording (only when the business records calls). */
    recordingKey: text("recording_key"),
    /** Voice calls: per-turn latency, written by the voice worker when the call ends. */
    voiceMetrics: jsonb("voice_metrics").$type<VoiceMetrics>(),
    /** ADR 0025: the department the caller chose (or the assistant moved them to). */
    departmentId: uuid("department_id"),
    /** Phone calls: "direct", "forwarded" (detected) or "backup" (the business's setting). */
    entry: text("entry").notNull().default("direct"),
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
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
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
/**
 * A business's connected external calendar (Phase 3, ADR 0014). The OAuth refresh token is
 * encrypted with SecretBox (context `calendar_connections:<id>`); one per provider per business.
 */
export const calendarConnections = pgTable(
  "calendar_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    accountEmail: text("account_email"),
    /** Calendar bookings go into (and whose busy times are respected). Null until chosen. */
    calendarId: text("calendar_id"),
    calendarName: text("calendar_name"),
    refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
    /** active | error (temporary) | revoked (must reconnect). */
    status: text("status").notNull().default("active"),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    connectedBy: uuid("connected_by"),
    ...timestamps,
  },
  (t) => [uniqueIndex("calendar_connections_tenant_provider_uq").on(t.tenantId, t.provider)],
);

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
    /** Event in the business's external calendar (Google), when one is connected. */
    calendarConnectionId: uuid("calendar_connection_id").references(() => calendarConnections.id, {
      onDelete: "set null",
    }),
    externalEventId: text("external_event_id"),
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
 * ADR 0026: unanswered questions grouped by meaning, with an answer drafted from the
 * business's own documents. Nothing reaches the assistant until a person approves it (it
 * then becomes an FAQ in the approved profile).
 */
export const gapAnswers = pgTable(
  "gap_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    embedding: vector("embedding", { dimensions: 384 }).notNull(),
    count: integer("count").notNull().default(1),
    lastAskedAt: timestamp("last_asked_at", { withTimezone: true }).notNull().defaultNow(),
    /** Drafted from the business's documents; null when they don't cover it. */
    draft: text("draft"),
    sources: jsonb("sources")
      .$type<Array<{ title: string | null; url: string | null }>>()
      .notNull()
      .default([]),
    /** When drafting was attempted (null: not yet, e.g. while AI was paused). */
    draftedAt: timestamp("drafted_at", { withTimezone: true }),
    /** pending | approved | dismissed */
    status: text("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gap_answers_tenant_status_idx").on(t.tenantId, t.status)],
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
    /** ADR 0026: the group this question belongs to (set by the drafting job). */
    gapAnswerId: uuid("gap_answer_id").references(() => gapAnswers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("knowledge_gaps_tenant_status_idx").on(t.tenantId, t.status)],
);

/**
 * Public entry points (Phase 4): website chat widget keys, form keys, WhatsApp phone-number ids.
 * Resolved without a signed-in user through app_resolve_public_endpoint() (SQL), which only
 * returns the matching row.
 */
export const publicEndpoints = pgTable(
  "public_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** "widget" | "form" | "whatsapp" */
    kind: text("kind").notNull(),
    /** Public key (widget/form) or the WhatsApp phone-number id. */
    key: text("key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("public_endpoints_kind_key_uq").on(t.kind, t.key),
    index("public_endpoints_tenant_idx").on(t.tenantId),
  ],
);

/**
 * One customer's conversation stream on a channel (Phase 4, unified inbox): the outside
 * identity (widget visitor, WhatsApp number, email thread), its current conversation, and
 * whether the assistant or a person is answering.
 */
export const channelThreads = pgTable(
  "channel_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    channel: conversationChannel("channel").notNull(),
    externalId: text("external_id").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    /** "ai": the assistant replies; "human": a person has taken over. */
    mode: text("mode").notNull().default("ai"),
    assigneeUserId: uuid("assignee_user_id"),
    /** The customer asked for a person and nobody has picked it up yet. */
    needsHuman: boolean("needs_human").notNull().default(false),
    unread: integer("unread").notNull().default(0),
    displayName: text("display_name"),
    subject: text("subject"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    lastPreview: text("last_preview"),
    /** Channel details, e.g. email threading headers (lastMessageId, references). */
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("channel_threads_tenant_channel_external_uq").on(
      t.tenantId,
      t.channel,
      t.externalId,
    ),
    index("channel_threads_tenant_last_idx").on(t.tenantId, t.lastMessageAt),
  ],
);

/**
 * A business's connected support mailbox (Phase 4, ADR 0017): IMAP to read, SMTP to reply.
 * The app password is encrypted with SecretBox (context `mailboxes:<tenantId>`).
 */
export const mailboxes = pgTable(
  "mailboxes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    emailAddress: text("email_address").notNull(),
    username: text("username").notNull(),
    passwordEncrypted: text("password_encrypted").notNull(),
    imapHost: text("imap_host").notNull(),
    imapPort: integer("imap_port").notNull(),
    imapSecure: boolean("imap_secure").notNull().default(true),
    smtpHost: text("smtp_host").notNull(),
    smtpPort: integer("smtp_port").notNull(),
    smtpSecure: boolean("smtp_secure").notNull().default(true),
    folder: text("folder").notNull().default("INBOX"),
    /** Send the assistant's replies straight away (simple answers only); otherwise drafts. */
    autoSend: boolean("auto_send").notNull().default(false),
    uidValidity: bigint("uid_validity", { mode: "number" }),
    lastUid: bigint("last_uid", { mode: "number" }).notNull().default(0),
    /** active | error */
    status: text("status").notNull().default("active"),
    lastError: text("last_error"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("mailboxes_tenant_uq").on(t.tenantId)],
);

/**
 * A phone call handed from the assistant to a person at the VA console (Phase 5, ADR 0018).
 * waiting → answered → returned (back to the assistant) / ended; or waiting → missed.
 */
export const handoffs = pgTable(
  "handoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    roomName: text("room_name").notNull(),
    reason: text("reason"),
    urgent: boolean("urgent").notNull().default(false),
    /** ADR 0025: rings only this department's people (when it has any). */
    departmentId: uuid("department_id"),
    status: text("status").notNull().default("waiting"),
    answeredBy: uuid("answered_by").references(() => user.id, { onDelete: "set null" }),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("handoffs_tenant_status_idx").on(t.tenantId, t.status),
    index("handoffs_conversation_idx").on(t.conversationId),
  ],
);

/**
 * Customer feedback (Phase 6, ADR 0020): one survey per conversation. `score` stays null
 * until the customer answers. CSAT is 1–5, NPS 0–10.
 */
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    channel: text("channel").notNull(),
    kind: text("kind").notNull().default("csat"),
    /** "<tenantId>.<random>": the public rating link's key. */
    token: text("token").notNull(),
    /** Who looked after the customer: "ai", or "person" when someone took over. */
    handledBy: text("handled_by").notNull().default("ai"),
    language: text("language").notNull().default("en"),
    score: integer("score"),
    comment: text("comment"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("feedback_token_uq").on(t.token),
    uniqueIndex("feedback_conversation_uq").on(t.conversationId),
    index("feedback_tenant_sent_idx").on(t.tenantId, t.sentAt),
  ],
);

/**
 * Calls the assistant places itself (Phase 6, ADR 0019): callbacks customers asked for and
 * booking confirmations. The API's dialler picks up due rows; each attempt is a conversation.
 */
export const outboundCalls = pgTable(
  "outbound_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** "callback" or "confirmation". */
    purpose: text("purpose").notNull(),
    phone: text("phone").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
    /** What it's about (e.g. the ticket or message reference and summary). */
    reason: text("reason"),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    language: text("language"),
    notBefore: timestamp("not_before", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(2),
    /** scheduled → calling → answered / voicemail / no_answer / cancelled / failed. */
    status: text("status").notNull().default("scheduled"),
    outcome: text("outcome"),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    ...timestamps,
  },
  (t) => [
    index("outbound_calls_due_idx").on(t.status, t.notBefore),
    index("outbound_calls_tenant_idx").on(t.tenantId, t.createdAt),
  ],
);

/**
 * Actions the back-office assistant ("Ask VoiceDesk", Phase 6, ADR 0020) proposes. Nothing
 * that changes data or contacts a customer runs until a person approves it.
 */
export const assistantActions = pgTable(
  "assistant_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Who asked (the proposal is shown to them; anyone allowed to do it may approve). */
    requestedBy: uuid("requested_by").references(() => user.id, { onDelete: "set null" }),
    /** "reply" | "cancel_booking" | "schedule_callback". */
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** What will happen, in plain words, for the approval card. */
    summary: text("summary").notNull(),
    /** pending → done / failed, or rejected. */
    status: text("status").notNull().default("pending"),
    result: text("result"),
    decidedBy: uuid("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assistant_actions_tenant_idx").on(t.tenantId, t.status, t.createdAt)],
);

/** Spend that isn't recorded elsewhere (texts sent through a real carrier). ADR 0022. */
export const spendEvents = pgTable(
  "spend_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // "sms"
    units: integer("units").notNull(),
    amountPence: numeric("amount_pence", { precision: 12, scale: 4, mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("spend_events_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

/** Spend alerts already sent (80% / 100% per category per month), so each goes out once. */
export const spendAlerts = pgTable(
  "spend_alerts",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    month: text("month").notNull(), // YYYY-MM in the business's time zone
    category: text("category").notNull(), // "ai" | "sms" | "calls"
    level: integer("level").notNull(), // 80 | 100
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("spend_alerts_once_idx").on(t.tenantId, t.month, t.category, t.level)],
);

/**
 * Inbound messages already handled (security audit M6): providers can deliver the same
 * webhook more than once, sometimes days apart. One row per business, channel and message id.
 */
export const processedMessages = pgTable(
  "processed_messages",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(), // "whatsapp" | "form"
    externalId: text("external_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("processed_messages_once_idx").on(t.tenantId, t.channel, t.externalId)],
);
