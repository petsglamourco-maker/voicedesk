import type { EmbeddingProvider, LlmProvider } from "@voicedesk/adapters";
import {
  createDbAgentServices,
  persistTurn,
  recordDepartmentChoice,
  type DepartmentInfo,
  runTurn,
  type AgentContext,
  type DbServiceDeps,
  type ConversationState,
  type Lang,
  type TurnResult,
} from "@voicedesk/agent-brain";
import { conversationMessages, withTenant, type Database } from "@voicedesk/db";

export interface BridgeDeps {
  db: Database;
  llm: LlmProvider;
  embeddings: EmbeddingProvider;
  /** External calendar access (Phase 3); see DbServiceDeps. */
  calendars?: DbServiceDeps["calendars"];
  /** Confirmations, reminders and staff alerts; see DbServiceDeps. */
  notify?: DbServiceDeps["notify"];
  /** Phone calls: callers can be put through to a person (SIP transfer). */
  canTransfer?: boolean;
  /** Phone calls: whether someone at the VA console can take the call now (Phase 5). */
  peopleAvailable?: () => Promise<boolean>;
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
  /** A hold-on phrase was spoken because the reply was slow (llmFirstTextMs is when). */
  filler?: boolean;
}

/**
 * Runs caller turns from the voice pipeline through the same conversation engine as the
 * text console (ADR 0013). Turns are serialised: if the caller speaks again while a turn
 * (e.g. a booking) is still being saved, the next turn waits for it.
 */
export class EngineBridge {
  private state: ConversationState;
  private queue: Promise<unknown> = Promise.resolve();
  /**
   * True while the call is with (or ringing for) a person at the VA console: the assistant
   * doesn't answer, and what the caller says is saved as transcript only.
   */
  humanActive = false;
  /** Hold-on phrases spoken so far in this call (picks the next variant). */
  fillersSpoken = 0;
  /** Whether the previous reply needed a hold-on phrase (the next one waits longer). */
  lastTurnHadFiller = false;

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
        {
          db: this.deps.db,
          embeddings: this.deps.embeddings,
          calendars: this.deps.calendars,
          notify: this.deps.notify,
        },
        {
          ...this.ids,
          businessName: this.ctx.businessName,
          timezone: this.ctx.timezone,
          canTransfer: this.deps.canTransfer,
          peopleAvailable: this.deps.peopleAvailable,
        },
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

  /**
   * Adds an engine note to the conversation history (e.g. "the transfer failed"), so the next
   * turn knows. Saved with that turn.
   */
  note(text: string): void {
    this.state = {
      ...this.state,
      transfer: undefined,
      history: [...this.state.history, { role: "system", content: `[Engine note] ${text}` }],
    };
  }

  /**
   * Saves what the caller said while a person had the call (transcript only, no engine
   * turn), in order with the other turns.
   */
  saveCallerSpeech(text: string): Promise<void> {
    const run = async () => {
      await withTenant(this.deps.db, this.ids.tenantId, (tx) =>
        tx.insert(conversationMessages).values({
          tenantId: this.ids.tenantId,
          conversationId: this.ids.conversationId,
          role: "caller",
          content: text,
          language: this.state.language,
          metadata: { channel: "voice", withPerson: true },
        }),
      ).catch((error: unknown) => this.hooks.onError?.(error));
    };
    const next = this.queue.then(run, run);
    this.queue = next;
    return next;
  }

  /** The department the caller is in (keypad, speech or moved by the assistant). */
  get department(): { id: string; key: number; name: string } | null {
    return this.state.department ?? null;
  }

  /**
   * A keypad choice (ADR 0025): no model call. The department is saved now; the note and the
   * fixed sentence that was spoken go into the history, saved with the next turn.
   */
  chooseDepartment(d: DepartmentInfo, spoken: string): Promise<void> {
    const run = async () => {
      this.state = {
        ...this.state,
        department: { id: d.id, key: d.key, name: d.name },
        history: [
          ...this.state.history,
          {
            role: "system",
            content: `[Engine note] The caller pressed ${d.key} for ${d.name}. You said: "${spoken}"`,
          },
        ],
      };
      try {
        await recordDepartmentChoice(this.deps.db, {
          ...this.ids,
          departmentId: d.id,
          via: "keypad",
        });
        await withTenant(this.deps.db, this.ids.tenantId, (tx) =>
          tx.insert(conversationMessages).values({
            tenantId: this.ids.tenantId,
            conversationId: this.ids.conversationId,
            role: "agent",
            content: spoken,
            language: this.state.language,
            metadata: { channel: "voice", keypad: d.key },
          }),
        );
      } catch (error) {
        this.hooks.onError?.(error);
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
