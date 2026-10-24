import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants, timestamps } from "./app";
import { user } from "./auth";

/**
 * Platform-wide settings managed by the platform owner (not tenant data, so no tenant_id).
 * RLS: readable by the runtime role, writable only under withPlatformAccess (audited).
 */

export const aiProviderKind = pgEnum("ai_provider_kind", ["anthropic", "openai_compatible"]);

export interface AiProviderOptions {
  /** Let the model think before answering, per task (off = faster live replies). */
  thinking: { realtime: boolean; reasoning: boolean };
  /** How the server is told to think or not. */
  thinkingControl: "deepseek" | "reasoning_effort" | "none";
  structuredOutput: "json_schema" | "json_object";
  timeoutMs: number;
  /** USD per million tokens for cost reporting. */
  pricing: { inputPerM: number; outputPerM: number; cachedInputPerM?: number };
}

export interface AiProviderTestResult {
  ok: boolean;
  latencyMs: number;
  model: string;
  error?: string;
  toolCalls?: boolean;
  /** Set when the server read far fewer prompt tokens than were sent (context window too small). */
  contextWarning?: string;
  at: string;
}

export const aiProviders = pgTable("ai_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Stable key used for history tagging: "anthropic", "deepseek", "local"… */
  key: text("key").notNull().unique(),
  kind: aiProviderKind("kind").notNull(),
  name: text("name").notNull(),
  baseUrl: text("base_url"),
  /** AES-256-GCM ciphertext (see @voicedesk/core secret-box). Never returned to clients. */
  apiKeyEncrypted: text("api_key_encrypted"),
  enabled: boolean("enabled").notNull().default(false),
  priority: integer("priority").notNull(),
  /** Model for live conversations and for background work (profile, summaries). */
  models: jsonb("models").$type<{ realtime: string; reasoning: string }>().notNull(),
  options: jsonb("options").$type<AiProviderOptions>().notNull(),
  /** Shown in the admin UI (e.g. data location warnings). */
  notes: text("notes"),
  lastTest: jsonb("last_test").$type<AiProviderTestResult>(),
  updatedBy: uuid("updated_by"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  ...timestamps,
});

/**
 * "Contact support" requests from the in-app Help assistant (ADR 0021). Anyone signed in can
 * create one for themselves; only the platform owner reads and resolves them, under
 * withPlatformAccess (audited). RLS in migrations (custom SQL).
 */
export const supportRequestStatus = pgEnum("support_request_status", ["open", "resolved"]);

export const supportRequests = pgTable(
  "support_requests",
  {
    id: uuid("id").primaryKey(),
    /** The business they were in, if any. */
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Screen they asked from (ids removed). */
    page: text("page").notNull(),
    message: text("message").notNull(),
    /** The help chat, only when they ticked "include this conversation". */
    chat: jsonb("chat").$type<Array<{ role: "user" | "assistant"; text: string }>>(),
    status: supportRequestStatus("status").notNull().default("open"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("support_requests_status_idx").on(t.status, t.createdAt)],
);

/**
 * Browsers/devices each account has signed in from (security audit: new-device alerts).
 * Only a hash of the browser and OS family is kept, never the raw user agent or IP.
 */
export const knownDevices = pgTable(
  "known_devices",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceHash: text("device_hash").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.deviceHash] })],
);
