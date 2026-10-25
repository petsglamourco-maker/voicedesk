import {
  RoutedLlmProvider,
  responseText,
  type LlmProvider,
  type RouteEntry,
} from "@voicedesk/adapters";
import { AnthropicLlmProvider } from "@voicedesk/adapters/llm/anthropic";
import { OpenAiCompatibleProvider } from "@voicedesk/adapters/llm/openai-compatible";
import {
  aiProviders,
  withPlatformAccess,
  type AiProviderOptions,
  type AiProviderTestResult,
  type Database,
} from "@voicedesk/db";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { maskSecret, type SecretBox } from "./secret-box";

/**
 * Platform AI provider settings (ADR 0012): which LLMs the app uses, in what order.
 * The router reads them every few seconds, so admin changes apply without a restart.
 */

export type AiProviderRow = typeof aiProviders.$inferSelect;

export interface ProviderSecrets {
  box: SecretBox | null;
  /** Fallback for the Claude row when no key is saved in settings. */
  anthropicEnvKey?: string;
}

function storedKey(row: AiProviderRow, secrets: ProviderSecrets): string | undefined {
  if (!row.apiKeyEncrypted || !secrets.box) return undefined;
  try {
    return secrets.box.decrypt(row.apiKeyEncrypted, `ai_providers:${row.key}`);
  } catch {
    return undefined; // wrong SETTINGS_ENCRYPTION_KEY or tampered value: treat as missing
  }
}

/** Why a provider can't be used yet, or null if it's ready. */
export function missingRequirement(row: AiProviderRow, secrets: ProviderSecrets): string | null {
  if (row.kind === "anthropic") {
    return storedKey(row, secrets) || secrets.anthropicEnvKey ? null : "Add an Anthropic API key";
  }
  if (!row.baseUrl) return "Add the server URL";
  if (!row.models.realtime || !row.models.reasoning) return "Choose the models";
  if (row.key === "deepseek" && !storedKey(row, secrets)) return "Add a DeepSeek API key";
  return null;
}

export function buildProvider(row: AiProviderRow, secrets: ProviderSecrets): LlmProvider | null {
  if (missingRequirement(row, secrets)) return null;
  if (row.kind === "anthropic") {
    return new AnthropicLlmProvider({
      models: row.models,
      apiKey: storedKey(row, secrets) ?? secrets.anthropicEnvKey,
      timeoutMs: row.options.timeoutMs,
    });
  }
  return new OpenAiCompatibleProvider({
    key: row.key,
    baseUrl: row.baseUrl!,
    apiKey: storedKey(row, secrets),
    models: row.models,
    thinking: row.options.thinking,
    thinkingControl: row.options.thinkingControl,
    structuredOutput: row.options.structuredOutput,
    timeoutMs: row.options.timeoutMs,
    pricing: row.options.pricing,
  });
}

export async function listProviderRows(db: Database): Promise<AiProviderRow[]> {
  return db.select().from(aiProviders).orderBy(asc(aiProviders.priority));
}

/** The app-wide LLM: enabled, ready providers in priority order with fallback. */
export function createAppLlm(
  db: Database,
  secrets: ProviderSecrets,
  options: { log?: (msg: string, data: object) => void; ttlMs?: number } = {},
): RoutedLlmProvider {
  return new RoutedLlmProvider(
    async () => {
      const rows = await listProviderRows(db);
      return rows.flatMap((row): RouteEntry[] => {
        if (!row.enabled) return [];
        const provider = buildProvider(row, secrets);
        return provider ? [{ key: row.key, label: row.name, provider }] : [];
      });
    },
    {
      ttlMs: options.ttlMs ?? 10_000,
      onFallback: (info) => options.log?.("ai provider fallback", info),
    },
  );
}

// ── Admin operations (platform owner only; callers must check) ─────────────────────────

export interface ProviderView {
  id: string;
  key: string;
  kind: AiProviderRow["kind"];
  name: string;
  baseUrl: string | null;
  enabled: boolean;
  priority: number;
  models: { realtime: string; reasoning: string };
  options: AiProviderOptions;
  notes: string | null;
  apiKeyHint: string | null;
  usesEnvKey: boolean;
  ready: boolean;
  missing: string | null;
  lastTest: AiProviderTestResult | null;
}

export function toView(row: AiProviderRow, secrets: ProviderSecrets): ProviderView {
  const key = storedKey(row, secrets);
  const missing = missingRequirement(row, secrets);
  return {
    id: row.id,
    key: row.key,
    kind: row.kind,
    name: row.name,
    baseUrl: row.baseUrl,
    enabled: row.enabled,
    priority: row.priority,
    models: row.models,
    options: row.options,
    notes: row.notes,
    apiKeyHint: key ? maskSecret(key) : null,
    usesEnvKey: row.kind === "anthropic" && !key && Boolean(secrets.anthropicEnvKey),
    ready: missing === null,
    missing,
    lastTest: row.lastTest ?? null,
  };
}

export const providerUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  baseUrl: z
    .string()
    .trim()
    .url()
    .refine((u) => /^https?:\/\//.test(u), "Use an http(s) URL")
    .optional(),
  models: z
    .object({
      realtime: z.string().trim().min(1).max(200),
      reasoning: z.string().trim().min(1).max(200),
    })
    .optional(),
  options: z
    .object({
      thinking: z.object({ realtime: z.boolean(), reasoning: z.boolean() }),
      thinkingControl: z.enum(["deepseek", "reasoning_effort", "none"]),
      structuredOutput: z.enum(["json_schema", "json_object"]),
      timeoutMs: z.number().int().min(5_000).max(900_000),
      pricing: z.object({
        inputPerM: z.number().min(0).max(1000),
        outputPerM: z.number().min(0).max(1000),
        cachedInputPerM: z.number().min(0).max(1000).optional(),
      }),
    })
    .optional(),
  /** New key to store; "" clears the stored key. Omit to keep the current one. */
  apiKey: z.string().max(500).optional(),
});
export type ProviderUpdate = z.infer<typeof providerUpdateSchema>;

export async function updateProvider(
  db: Database,
  secrets: ProviderSecrets,
  actorUserId: string,
  id: string,
  patch: ProviderUpdate,
): Promise<AiProviderRow | null> {
  return withPlatformAccess(db, { actorUserId, reason: "ai provider settings" }, async (tx) => {
    const [row] = await tx.select().from(aiProviders).where(eq(aiProviders.id, id));
    if (!row) return null;
    const { apiKey, ...rest } = patch;
    let apiKeyEncrypted = row.apiKeyEncrypted;
    // nosemgrep: ajinabraham.njsscan.crypto.timing_attack_node.node_timing_attack -- reviewed: not a secret comparison (empty-string check / content hash)
    if (apiKey !== undefined) {
      if (apiKey.trim() === "") {
        apiKeyEncrypted = null;
      } else {
        if (!secrets.box) {
          throw new Error("SETTINGS_ENCRYPTION_KEY is not set, so API keys can't be stored safely");
        }
        apiKeyEncrypted = secrets.box.encrypt(apiKey.trim(), `ai_providers:${row.key}`);
      }
    }
    const [updated] = await tx
      .update(aiProviders)
      .set({ ...rest, apiKeyEncrypted, updatedBy: actorUserId })
      .where(eq(aiProviders.id, id))
      .returning();
    return updated ?? null;
  });
}

export async function reorderProviders(
  db: Database,
  actorUserId: string,
  ids: string[],
): Promise<void> {
  await withPlatformAccess(db, { actorUserId, reason: "ai provider order" }, async (tx) => {
    for (const [i, id] of ids.entries()) {
      await tx
        .update(aiProviders)
        .set({ priority: i + 1 })
        .where(eq(aiProviders.id, id));
    }
  });
}

/**
 * Live check: a tiny reply plus a tool call, with timing. Costs a fraction of a cent on
 * paid providers. The result is stored for the admin screen.
 */
export async function testProvider(
  db: Database,
  secrets: ProviderSecrets,
  actorUserId: string,
  id: string,
): Promise<AiProviderTestResult | null> {
  const [row] = await db.select().from(aiProviders).where(eq(aiProviders.id, id));
  if (!row) return null;
  const at = new Date().toISOString();
  const missing = missingRequirement(row, secrets);
  let result: AiProviderTestResult;
  if (missing) {
    result = { ok: false, latencyMs: 0, model: row.models.realtime, error: missing, at };
  } else {
    const provider = buildProvider(row, secrets)!;
    const started = Date.now();
    try {
      // A realistically long prompt (~6k tokens, like a real agent turn) also reveals
      // servers whose context window silently truncates the start of the prompt.
      const padding = Array.from(
        { length: 300 },
        (_, i) => `Reference line ${i + 1}: this is padding text for a context length check.`,
      ).join("\n");
      const reply = await provider.complete({
        tier: "realtime",
        system: [`You are a connection test. Reply with the single word OK.\n\n${padding}`],
        messages: [{ role: "user", content: "Say OK." }],
        maxTokens: 50,
        purpose: "admin.test",
      });
      const latencyMs = Date.now() - started;
      const sentTokens = Math.round(padding.length / 4);
      const readTokens = reply.usage.inputTokens + reply.usage.cacheReadTokens;
      const contextWarning =
        readTokens > 0 && readTokens < sentTokens * 0.6
          ? `The server only read ${readTokens} of about ${sentTokens} prompt tokens, so its context window is too small and the assistant's instructions get cut off. Set the context length to at least 16384 (Ollama: OLLAMA_CONTEXT_LENGTH=16384; llama.cpp: --ctx-size 16384; LM Studio: Context Length).`
          : undefined;
      const tools = await provider.complete({
        tier: "realtime",
        system: ["Use the ping tool when asked."],
        messages: [{ role: "user", content: "Please call the ping tool with message 'hi'." }],
        tools: [
          {
            name: "ping",
            description: "Connectivity check",
            inputSchema: {
              type: "object",
              properties: { message: { type: "string" } },
              required: ["message"],
            },
          },
        ],
        maxTokens: 200,
        purpose: "admin.test",
      });
      result = {
        ok: responseText(reply).length > 0,
        latencyMs,
        model: reply.usage.model,
        toolCalls: tools.stopReason === "tool_use",
        ...(contextWarning ? { contextWarning } : {}),
        at,
        ...(responseText(reply) ? {} : { error: "Empty reply" }),
      };
    } catch (error) {
      result = {
        ok: false,
        latencyMs: Date.now() - started,
        model: row.models.realtime,
        error: error instanceof Error ? error.message : "Test failed",
        at,
      };
    }
  }
  await withPlatformAccess(db, { actorUserId, reason: "ai provider test" }, (tx) =>
    tx.update(aiProviders).set({ lastTest: result }).where(eq(aiProviders.id, id)),
  );
  return result;
}

/** Models offered by an OpenAI-compatible server (helps pick the local model name). */
export async function listServerModels(
  row: AiProviderRow,
  secrets: ProviderSecrets,
): Promise<string[]> {
  if (row.kind !== "openai_compatible" || !row.baseUrl) return [];
  const provider = new OpenAiCompatibleProvider({
    key: row.key,
    baseUrl: row.baseUrl,
    apiKey: storedKey(row, secrets),
    models: row.models,
    thinking: row.options.thinking,
    thinkingControl: row.options.thinkingControl,
    structuredOutput: row.options.structuredOutput,
    timeoutMs: 15_000,
  });
  return provider.listModels();
}
