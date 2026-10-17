import OpenAI from "openai";
import { ProviderError } from "../errors";
import {
  nativeRawFor,
  type LlmContentBlock,
  type LlmMessage,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type ModelTier,
  type TaggedRaw,
} from "./types";

/**
 * Any OpenAI-compatible chat-completions server: DeepSeek, Ollama, LM Studio,
 * llama.cpp, vLLM… (ADR 0012). Supports streaming, tool calls and JSON output.
 */
export interface OpenAiCompatibleConfig {
  /** Stable key used to tag provider-native history (e.g. "deepseek", "local"). */
  key: string;
  baseUrl: string;
  apiKey?: string;
  models: Record<ModelTier, string>;
  /** Whether the model may "think" before answering, per tier (off = faster live turns). */
  thinking: Record<ModelTier, boolean>;
  /** How this server is told to think or not. */
  thinkingControl: "deepseek" | "reasoning_effort" | "none";
  /** json_schema (constrained decoding) or json_object (+ schema described in the prompt). */
  structuredOutput: "json_schema" | "json_object";
  timeoutMs?: number;
  /** USD per million tokens, for cost reporting (0 for local models). */
  pricing?: { inputPerM: number; outputPerM: number; cachedInputPerM?: number };
}

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ToolCall = { id: string; name: string; arguments: string };

/** Assistant message as replayed to the same server (keeps DeepSeek reasoning_content). */
interface NativeAssistant {
  content: string | null;
  reasoning_content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

const THINK_BLOCK = /<think>[\s\S]*?<\/think>\s*/g;

export function stripThinking(text: string): string {
  return text.replace(THINK_BLOCK, "").replace(/^[\s\S]*?<\/think>\s*/, "");
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: string;
  private readonly client: OpenAI;

  constructor(private readonly config: OpenAiCompatibleConfig) {
    this.name = `openai-compatible:${config.key}`;
    this.client = new OpenAI({
      baseURL: config.baseUrl,
      // Local servers usually ignore the key, but the SDK requires one.
      apiKey: config.apiKey || "not-needed",
      timeout: config.timeoutMs ?? 120_000,
      maxRetries: 1,
    });
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    return this.stream(request, () => undefined);
  }

  async stream(request: LlmRequest, onText: (delta: string) => void): Promise<LlmResponse> {
    const model = this.config.models[request.tier];
    const body = this.toParams(model, request);
    let content = "";
    let reasoning = "";
    let finish: string | null = null;
    // DeepSeek reports cache hits as prompt_cache_hit_tokens.
    let usage:
      (OpenAI.Completions.CompletionUsage & { prompt_cache_hit_tokens?: number }) | undefined;
    const calls = new Map<number, ToolCall>();
    const filter = new ThinkFilter(onText);

    try {
      const stream = await this.client.chat.completions.create({
        ...body,
        stream: true,
        stream_options: { include_usage: true },
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);
      for await (const chunk of stream) {
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta as typeof choice.delta & {
          reasoning_content?: string;
          reasoning?: string;
        };
        if (delta.content) {
          content += delta.content;
          filter.push(delta.content);
        }
        if (delta.reasoning_content) reasoning += delta.reasoning_content;
        for (const tc of delta.tool_calls ?? []) {
          const current = calls.get(tc.index) ?? { id: "", name: "", arguments: "" };
          if (tc.id) current.id = tc.id;
          if (tc.function?.name) current.name += tc.function.name;
          if (tc.function?.arguments) current.arguments += tc.function.arguments;
          calls.set(tc.index, current);
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
    } catch (error) {
      throw toProviderError(this.config.key, error);
    }

    const text = stripThinking(content).trim();
    const toolCalls = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, c], i) => ({
        ...c,
        id: c.id || `call_${i}`,
      }));
    const blocks: LlmContentBlock[] = [
      ...(text ? [{ type: "text" as const, text }] : []),
      ...toolCalls.map((c): LlmContentBlock => ({
        type: "tool_use",
        id: c.id,
        name: c.name,
        input: parseArguments(c.arguments),
      })),
    ];
    const native: NativeAssistant = {
      content: content || null,
      ...(reasoning ? { reasoning_content: reasoning } : {}),
      ...(toolCalls.length
        ? {
            tool_calls: toolCalls.map((c) => ({
              id: c.id,
              type: "function" as const,
              function: { name: c.name, arguments: c.arguments },
            })),
          }
        : {}),
    };

    const cached =
      usage?.prompt_tokens_details?.cached_tokens ?? usage?.prompt_cache_hit_tokens ?? 0;
    const input = Math.max(0, (usage?.prompt_tokens ?? 0) - cached);
    const output = usage?.completion_tokens ?? 0;
    const p = this.config.pricing ?? { inputPerM: 0, outputPerM: 0 };
    const costUsd =
      (input * p.inputPerM + cached * (p.cachedInputPerM ?? p.inputPerM) + output * p.outputPerM) /
      1_000_000;

    return {
      content: blocks,
      raw: { provider: this.config.key, data: native } satisfies TaggedRaw,
      stopReason:
        toolCalls.length > 0 || finish === "tool_calls"
          ? "tool_use"
          : finish === "length"
            ? "max_tokens"
            : finish === "content_filter"
              ? "refusal"
              : "end_turn",
      usage: {
        model,
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
        costUsd: Math.round(costUsd * 1e6) / 1e6,
      },
    };
  }

  /** Lists the models the server offers (used by the admin screen). */
  async listModels(): Promise<string[]> {
    try {
      const page = await this.client.models.list();
      return page.data.map((m) => m.id).sort();
    } catch (error) {
      throw toProviderError(this.config.key, error);
    }
  }

  private toParams(model: string, request: LlmRequest): Record<string, unknown> {
    const json = request.jsonSchema;
    let system = request.system.join("\n\n");
    if (json && this.config.structuredOutput === "json_object") {
      // JSON mode needs the word "json" and the expected shape in the prompt.
      system += `\n\nRespond with a single json object only (no prose, no code fences) that matches this JSON Schema:\n${JSON.stringify(json)}`;
    }
    const messages: ChatMessage[] = [{ role: "system", content: system }];
    for (const m of request.messages) messages.push(...this.toChatMessages(m));

    const thinking = this.config.thinking[request.tier];
    return {
      model,
      messages,
      max_tokens: request.maxTokens,
      ...(request.tools?.length
        ? {
            tools: request.tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.inputSchema },
            })),
          }
        : {}),
      ...(json
        ? this.config.structuredOutput === "json_schema"
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { name: "output", schema: json },
              },
            }
          : { response_format: { type: "json_object" } }
        : {}),
      ...(this.config.thinkingControl === "deepseek"
        ? { thinking: { type: thinking ? "enabled" : "disabled" } }
        : this.config.thinkingControl === "reasoning_effort" && !thinking
          ? { reasoning_effort: "none" }
          : {}),
    };
  }

  private toChatMessages(message: LlmMessage): ChatMessage[] {
    if (message.role === "system") {
      return [{ role: "system", content: textOf(message.content) }];
    }
    if (message.role === "assistant") {
      const native = nativeRawFor(message, this.config.key) as NativeAssistant | undefined;
      if (native) return [{ role: "assistant", ...native }];
      const blocks =
        typeof message.content === "string"
          ? [{ type: "text" as const, text: message.content }]
          : message.content;
      const text = blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const tools = blocks.flatMap((b) => (b.type === "tool_use" ? [b] : []));
      return [
        {
          role: "assistant",
          content: text || null,
          ...(tools.length
            ? {
                tool_calls: tools.map((t) => ({
                  id: t.id,
                  type: "function" as const,
                  function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) },
                })),
              }
            : {}),
        },
      ];
    }
    if (typeof message.content === "string") return [{ role: "user", content: message.content }];
    const out: ChatMessage[] = [];
    const texts: string[] = [];
    for (const block of message.content) {
      if (block.type === "tool_result") {
        out.push({
          role: "tool",
          tool_call_id: block.toolUseId,
          content: block.isError ? `ERROR: ${block.content}` : block.content,
        });
      } else if (block.type === "text") {
        texts.push(block.text);
      }
    }
    if (texts.length) out.push({ role: "user", content: texts.join("\n") });
    return out;
  }
}

function textOf(content: LlmMessage["content"]): string {
  return typeof content === "string"
    ? content
    : content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
}

function parseArguments(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Returned as-is: the engine's schema validation rejects it and the model retries.
    return { _unparsable: raw };
  }
}

/** Hides <think>…</think> sections from streamed text (some local models emit them inline). */
class ThinkFilter {
  private buffer = "";
  private thinking = false;
  private started = false;

  constructor(private readonly emit: (text: string) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      if (this.thinking) {
        const end = this.buffer.indexOf("</think>");
        if (end === -1) return;
        this.buffer = this.buffer.slice(end + "</think>".length).replace(/^\s+/, "");
        this.thinking = false;
        continue;
      }
      const start = this.buffer.indexOf("<think>");
      if (start === -1) {
        // Keep a partial "<thi" tail in case the tag is split across chunks.
        const keep = partialTagTail(this.buffer);
        const out = this.buffer.slice(0, this.buffer.length - keep);
        this.buffer = this.buffer.slice(this.buffer.length - keep);
        if (out) {
          this.emit(this.started ? out : out.replace(/^\s+/, ""));
          this.started = this.started || out.trim().length > 0;
        }
        return;
      }
      const before = this.buffer.slice(0, start);
      if (before.trim()) {
        this.emit(before);
        this.started = true;
      }
      this.buffer = this.buffer.slice(start + "<think>".length);
      this.thinking = true;
    }
  }
}

function partialTagTail(text: string): number {
  const tag = "<think>";
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
    if (tag.startsWith(text.slice(-n))) return n;
  }
  return 0;
}

function toProviderError(key: string, error: unknown): ProviderError {
  if (error instanceof OpenAI.RateLimitError) {
    return new ProviderError(key, "rate limited", { retryable: true, cause: error });
  }
  if (
    error instanceof OpenAI.AuthenticationError ||
    error instanceof OpenAI.PermissionDeniedError
  ) {
    return new ProviderError(key, "API key rejected", { retryable: false, cause: error });
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new ProviderError(key, "timed out", { retryable: true, cause: error });
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new ProviderError(key, "cannot connect to the server", {
      retryable: true,
      cause: error,
    });
  }
  if (error instanceof OpenAI.NotFoundError) {
    return new ProviderError(key, `not found (check the model name and URL): ${error.message}`, {
      retryable: false,
      cause: error,
    });
  }
  if (error instanceof OpenAI.APIError) {
    return new ProviderError(key, `API error ${error.status}: ${error.message}`, {
      retryable: (error.status ?? 500) >= 500,
      cause: error,
    });
  }
  return new ProviderError(key, error instanceof Error ? error.message : "unexpected error", {
    retryable: false,
    cause: error,
  });
}
