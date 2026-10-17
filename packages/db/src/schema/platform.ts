import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./app";

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
