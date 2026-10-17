import type { EmbeddingProvider, LlmProvider } from "@voicedesk/adapters";
import {
  createDbAgentServices,
  persistTurn,
  runTurn,
  type AgentContext,
  type ConversationState,
  type Lang,
  type TurnResult,
} from "@voicedesk/agent-brain";
import type { Database } from "@voicedesk/db";

export interface BridgeDeps {
  db: Database;
  llm: LlmProvider;
  embeddings: EmbeddingProvider;
}

export interface TurnTimings {
  /** Caller stopped speaking → turn committed (VAD + turn detector), from LiveKit metrics. */
  endOfUtteranceMs?: number;
  /** Caller stopped speaking → final transcript, from LiveKit metrics. */
  transcriptionMs?: number;
  /** Turn handed to the engine → first text streamed to TTS. */
  llmFirstTextMs?: number;
  /** First text → first audio byte from TTS, from LiveKit metrics. */
  ttsFirstByteMs?: number;
  /** Engine turn including tools. */
  engineMs?: number;
}

/**
 * Runs caller turns from the voice pipeline through the same conversation engine as the
 * text console (ADR 0013). Turns are serialised: if the caller speaks again while a turn
 * (e.g. a booking) is still being saved, the next turn waits for it.
 */
export class EngineBridge {
  private state: ConversationState;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly deps: BridgeDeps,
    private readonly ctx: AgentContext,
    private readonly ids: { tenantId: string; conversationId: string },
    initial: ConversationState,
    private readonly hooks: {
      onLanguage?: (language: Lang) => void;
      onTurn?: (result: TurnResult, callerText: string) => void;
      onError?: (error: unknown) => void;
    } = {},
  ) {
    this.state = initial;
  }

  get language(): Lang {
    return this.state.language;
  }

  get turns(): number {
    return this.state.turns;
  }

  /**
   * Runs one turn, streaming reply text to `onText` as it is generated (so speech starts
   * before tools finish). Resolves when the turn is saved.
   */
  handleTurn(
    callerText: string,
    onText: (delta: string) => void,
    extraMetadata: () => Record<string, unknown> = () => ({}),
  ): Promise<TurnResult | null> {
    const run = async (): Promise<TurnResult | null> => {
      const previous = this.state;
      const services = createDbAgentServices(
        { db: this.deps.db, embeddings: this.deps.embeddings },
        { ...this.ids, businessName: this.ctx.businessName },
      );
      try {
        const result = await runTurn(
          { llm: this.deps.llm, services },
          this.ctx,
          previous,
          callerText,
          { onText },
        );
        const saved = await persistTurn(this.deps.db, {
          ...this.ids,
          previous,
          callerText,
          result,
          extraMetadata: { channel: "voice", ...extraMetadata() },
        });
        if (!saved) throw new Error("conversation was updated elsewhere");
        this.state = result.state;
        if (result.state.language !== previous.language) {
          this.hooks.onLanguage?.(result.state.language);
        }
        this.hooks.onTurn?.(result, callerText);
        return result;
      } catch (error) {
        this.hooks.onError?.(error);
        return null;
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next;
    return next;
  }

  /** Waits for any turn still in progress (call before ending the conversation). */
  async drain(): Promise<void> {
    await this.queue.catch(() => undefined);
  }
}

/** Median of the defined values, or null. */
export function median(values: (number | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : Math.round((v[mid - 1]! + v[mid]!) / 2);
}
