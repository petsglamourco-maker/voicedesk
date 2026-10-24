import Anthropic from "@anthropic-ai/sdk";
import { ProviderError } from "../errors";
import { estimateCostUsd } from "./pricing";
import {
  nativeRawFor,
  type LlmContentBlock,
  type LlmMessage,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type ModelTier,
  type TaggedRaw,
  REALTIME_TIMEOUT_MS,
} from "./types";

export interface AnthropicLlmConfig {
  /** Concrete model id per tier, e.g. { realtime: "claude-haiku-5-5", reasoning: "claude-sonnet-5-5" }. */
  models: Record<ModelTier, string>;
  apiKey?: string;
  /** Request timeout in ms (SDK default is 10 minutes). */
  timeoutMs?: number;
}

const DEFAULT_EFFORT: Record<ModelTier, "low" | "medium"> = {
  realtime: "low",
  reasoning: "medium",
};

/** Claude via the official SDK. See ADR 0007 and the claude-api skill notes in CLAUDE.md. */
/** Live (realtime) turns fail fast so the router can fall back (security audit M15). */
const timeoutFor = (request: LlmRequest) =>
  request.tier === "realtime" ? { timeout: REALTIME_TIMEOUT_MS } : undefined;

export class AnthropicLlmProvider implements LlmProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(private readonly config: AnthropicLlmConfig) {
    this.client = new Anthropic({
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      timeout: config.timeoutMs ?? 120_000,
      maxRetries: 2,
    });
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    return this.run(request, async (params) =>
      this.client.messages.create(params, timeoutFor(request)),
    );
  }

  async stream(request: LlmRequest, onText: (delta: string) => void): Promise<LlmResponse> {
    return this.run(request, async (params) => {
      const stream = this.client.messages.stream(params, timeoutFor(request));
      stream.on("text", onText);
      return stream.finalMessage();
    });
  }

  private async run(
    request: LlmRequest,
    send: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>,
  ): Promise<LlmResponse> {
    const model = this.config.models[request.tier];
    const params = this.toParams(model, request);
    let message: Anthropic.Message;
    try {
      message = await send(params);
    } catch (error) {
      throw toProviderError(error);
    }
    return fromMessage(model, message);
  }

  private toParams(model: string, request: LlmRequest): Anthropic.MessageCreateParamsNonStreaming {
    const system: Anthropic.TextBlockParam[] = request.system.map((text, i, all) => ({
      type: "text",
      text,
      // Tools render before system, so this breakpoint caches tools + the whole system prompt.
      ...(i === all.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));
    return {
      model,
      max_tokens: request.maxTokens,
      system,
      messages: request.messages.map(toMessageParam),
      ...(request.tools?.length
        ? {
            tools: request.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
            })),
          }
        : {}),
      output_config: {
        effort: request.effort ?? DEFAULT_EFFORT[request.tier],
        ...(request.jsonSchema
          ? { format: { type: "json_schema" as const, schema: request.jsonSchema } }
          : {}),
      },
    };
  }
}

function toMessageParam(message: LlmMessage): Anthropic.MessageParam {
  const native = message.role === "assistant" ? nativeRawFor(message, "anthropic") : undefined;
  if (native) {
    // Replay Claude's own content (including thinking blocks) unchanged.
    return { role: "assistant", content: native as Anthropic.ContentBlockParam[] };
  }
  if (typeof message.content === "string") {
    return { role: message.role, content: message.content };
  }
  return {
    role: message.role,
    content: message.content.map((block): Anthropic.ContentBlockParam => {
      switch (block.type) {
        case "text":
          return { type: "text", text: block.text };
        case "tool_use":
          return { type: "tool_use", id: block.id, name: block.name, input: block.input };
        case "tool_result":
          return {
            type: "tool_result",
            tool_use_id: block.toolUseId,
            content: block.content,
            ...(block.isError ? { is_error: true } : {}),
          };
      }
    }),
  };
}

function fromMessage(model: string, message: Anthropic.Message): LlmResponse {
  const content: LlmContentBlock[] = message.content.flatMap((block): LlmContentBlock[] => {
    if (block.type === "text") return [{ type: "text", text: block.text }];
    if (block.type === "tool_use") {
      return [{ type: "tool_use", id: block.id, name: block.name, input: block.input }];
    }
    return []; // thinking etc. are preserved in `raw`
  });
  const u = message.usage;
  const tokens = {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
  return {
    content,
    raw: { provider: "anthropic", data: message.content } satisfies TaggedRaw,
    stopReason:
      message.stop_reason === "end_turn" ||
      message.stop_reason === "tool_use" ||
      message.stop_reason === "max_tokens" ||
      message.stop_reason === "refusal"
        ? message.stop_reason
        : "other",
    usage: {
      model: message.model,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cacheReadTokens: tokens.cacheRead,
      cacheWriteTokens: tokens.cacheWrite,
      costUsd: estimateCostUsd(model, tokens),
    },
  };
}

function toProviderError(error: unknown): ProviderError {
  if (error instanceof Anthropic.RateLimitError) {
    return new ProviderError("anthropic", "rate limited", { retryable: true, cause: error });
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new ProviderError("anthropic", "invalid API key", { retryable: false, cause: error });
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new ProviderError("anthropic", `bad request: ${error.message}`, {
      retryable: false,
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError("anthropic", "connection failed", { retryable: true, cause: error });
  }
  if (error instanceof Anthropic.APIError) {
    const retryable = (error.status ?? 500) >= 500;
    return new ProviderError("anthropic", `API error ${error.status}`, { retryable, cause: error });
  }
  return new ProviderError("anthropic", "unexpected error", { retryable: false, cause: error });
}
