// v0 interface — implemented with the Anthropic SDK in Phase 1.

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
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
}

export type LlmContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export interface LlmMessage {
  role: "user" | "assistant";
  content: string | LlmContentBlock[];
}

export interface LlmRequest {
  tier: ModelTier;
  /** System prompt segments; providers may cache stable leading segments. */
  system: string[];
  messages: LlmMessage[];
  tools?: LlmTool[];
  maxTokens: number;
  temperature?: number;
}

export interface LlmUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface LlmResponse {
  content: LlmContentBlock[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "other";
  usage: LlmUsage;
}

export interface LlmProvider {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
  /** Streams text deltas; resolves with the full response once complete. */
  stream(request: LlmRequest, onText: (delta: string) => void): Promise<LlmResponse>;
}
