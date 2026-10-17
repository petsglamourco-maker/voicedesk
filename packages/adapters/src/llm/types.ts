/**
 * Logical model tiers. Each provider maps tiers to concrete model ids from config, so
 * business logic never hard-codes model strings.
 *  - realtime: fast model for live conversation turns
 *  - reasoning: stronger model for summaries, ingestion, classification, VA tasks
 */
export type ModelTier = "realtime" | "reasoning";

export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema for the tool input (object schema with additionalProperties: false). */
  inputSchema: Record<string, unknown>;
}

export type LlmContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

/**
 * Conversation message. `system` messages are mid-conversation operator instructions
 * (e.g. the state machine's "current step" note); they must follow a user message.
 * Provider-specific blocks (e.g. thinking) are kept opaquely in `raw` and replayed as-is.
 */
export interface LlmMessage {
  role: "user" | "assistant" | "system";
  content: string | LlmContentBlock[];
  /** Provider-native content to replay unchanged (assistant turns only). */
  raw?: unknown;
}

export interface LlmRequest {
  tier: ModelTier;
  /**
   * System prompt segments, most stable first. The provider marks the last segment as a
   * cache breakpoint, so volatile content must not go here.
   */
  system: string[];
  messages: LlmMessage[];
  tools?: LlmTool[];
  maxTokens: number;
  /** Constrain the final text to this JSON Schema (structured output). */
  jsonSchema?: Record<string, unknown>;
  /** Thinking/effort level; defaults per tier (realtime: low, reasoning: medium). */
  effort?: "low" | "medium" | "high";
  /** For usage attribution, e.g. "conversation.turn". */
  purpose?: string;
}

export interface LlmUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Estimated from the price table in ./pricing.ts. */
  costUsd: number;
}

export interface LlmResponse {
  content: LlmContentBlock[];
  /** Provider-native assistant content to append to history unchanged. */
  raw: unknown;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";
  usage: LlmUsage;
}

export interface LlmProvider {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
  /** Streams text deltas; resolves with the full response once complete. */
  stream(request: LlmRequest, onText: (delta: string) => void): Promise<LlmResponse>;
}

export function responseText(response: LlmResponse): string {
  return response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
}
