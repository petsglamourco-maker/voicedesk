import {
  ProviderError,
  responseText,
  type LlmContentBlock,
  type LlmProvider,
  type LlmUsage,
} from "@voicedesk/adapters";
import { detectLanguage } from "@voicedesk/knowledge";
import type { AgentContext } from "./context";
import { isLang, type Lang } from "./languages";
import {
  emergencyMessage,
  greeting,
  looksLikeLifeThreateningEmergency,
  recordingNotice,
  troubleMessage,
} from "./phrases";
import { buildSystemPrompt } from "./prompt";
import type { AgentServices } from "./services";
import { initialState, stepNote, type ConversationState, type CreatedRecord } from "./state";
import { runTool, toolDefinitions } from "./tools";

export type TurnEvent =
  | { type: "tool"; name: string; input: unknown; ok: boolean; result: unknown }
  | { type: "record"; record: CreatedRecord }
  | { type: "language"; language: Lang }
  | { type: "emergency" }
  | { type: "fallback"; reason: string };

export interface TurnResult {
  reply: string;
  state: ConversationState;
  events: TurnEvent[];
  usage: LlmUsage[];
  latencyMs: number;
}

export interface EngineDeps {
  llm: LlmProvider;
  services: AgentServices;
}

const MAX_TOOL_ROUNDS = 6;

/**
 * Short messages often defeat stopword detection. If the conversation is in a
 * non-Latin-script language but the caller writes mostly Latin letters, assume English
 * (the model can still switch precisely with set_language).
 */
function scriptFallback(text: string, current: Lang): Lang | null {
  if (current !== "zh" && current !== "ar") return null;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  return letters >= 8 && latin / letters > 0.8 ? "en" : null;
}

function localNow(ctx: AgentContext): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: ctx.timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ctx.now());
}

/**
 * Some models repeat, after a tool call, the sentence they wrote just before it ("Perfect,
 * nine o'clock. What's your full name?" twice). On a call that would be spoken twice, so the
 * repeat is held back while streaming and dropped if it matches the previous text.
 */
export class RepeatFilter {
  private buffer = "";
  private checking: boolean;
  private dropped = false;
  private emittedAfterDrop = false;

  constructor(
    private readonly previous: string,
    private readonly emit: (delta: string) => void,
  ) {
    // Only worth checking for real sentences, not "Okay."
    this.checking = previous.trim().length >= 12;
  }

  push(delta: string): void {
    if (!this.checking) {
      // Right after a dropped repeat, don't start the new text with a stray space.
      if (this.dropped && !this.emittedAfterDrop) {
        delta = delta.trimStart();
        if (!delta) return;
        this.emittedAfterDrop = true;
      }
      this.emit(delta);
      return;
    }
    this.buffer += delta;
    const prev = this.previous.trim();
    const sofar = this.buffer.trimStart();
    if (prev.startsWith(sofar)) {
      if (sofar.length >= prev.length) {
        this.dropped = true;
        this.checking = false;
        this.buffer = "";
      }
      return; // could still be a repeat: keep holding
    }
    this.checking = false;
    if (sofar.startsWith(prev)) {
      this.dropped = true;
      const rest = sofar.slice(prev.length).trimStart();
      if (rest) this.emittedAfterDrop = true;
      this.emit(rest);
    } else {
      this.emit(this.buffer);
    }
    this.buffer = "";
  }

  /** End of the round: text that only matched the start of the previous one is genuine. */
  end(): void {
    if (this.checking && this.buffer) this.emit(this.buffer);
    this.checking = false;
    this.buffer = "";
  }

  /** The round's full text without the dropped repeat (for the saved reply). */
  strip(text: string): string {
    if (!this.dropped) return text;
    return text.trimStart().slice(this.previous.trim().length).trim();
  }
}

/** Opens a conversation: fixed greeting with the mandatory AI disclosure. */
export function startConversation(
  ctx: AgentContext,
  options: { language?: Lang; callerPhone?: string | null; recordingNotice?: boolean } = {},
): { state: ConversationState; greeting: string } {
  const language = options.language ?? ctx.defaultLanguage;
  const state = initialState(language, options.callerPhone ?? null);
  const hello = greeting(language, {
    business: ctx.businessName,
    name: ctx.personaName,
    gender: ctx.persona.gender,
  });
  // Recording notice (brief §3.3) goes right after the AI disclosure, before the question.
  const text = options.recordingNotice ? `${hello} ${recordingNotice(language)}` : hello;
  // The API requires the first message to come from the user; mark the connection.
  state.history.push(
    { role: "user", content: "[Conversation started]" },
    { role: "assistant", content: text },
  );
  return { state, greeting: text };
}

/**
 * Runs one caller turn: deterministic safeguards, then the LLM with tools until it has
 * a reply. Returns a new state (the input is not mutated). Never throws for provider
 * failures — degrades to a fixed "take a message" reply instead.
 */
export async function runTurn(
  deps: EngineDeps,
  ctx: AgentContext,
  previous: ConversationState,
  callerText: string,
  options: { onText?: (delta: string) => void } = {},
): Promise<TurnResult> {
  const started = Date.now();
  const state = structuredClone(previous);
  // Per-turn instructions to the channel (hang up, transfer): never carried into a new turn.
  delete state.transfer;
  delete state.endRequested;
  const events: TurnEvent[] = [];
  const usage: LlmUsage[] = [];
  state.turns++;

  // Cheap language detection; the model can also switch explicitly via set_language.
  const detected = detectLanguage(callerText) ?? scriptFallback(callerText, state.language);
  if (isLang(detected) && detected !== state.language) {
    state.language = detected;
    events.push({ type: "language", language: detected });
  }

  // Life-threatening emergencies get a fixed, immediate answer (brief §3.4).
  if (!state.emergencyShown && looksLikeLifeThreateningEmergency(callerText)) {
    const reply = emergencyMessage(state.language, ctx.emergencyNumber);
    state.emergencyShown = true;
    state.flow = "emergency";
    state.history.push(
      { role: "user", content: callerText },
      { role: "assistant", content: reply },
    );
    options.onText?.(reply);
    events.push({ type: "emergency" });
    return { reply, state, events, usage, latencyMs: Date.now() - started };
  }

  state.history.push({ role: "user", content: callerText });
  state.history.push({
    role: "system",
    content: stepNote(state, localNow(ctx), ctx.profile?.sales.primaryGoal ?? "booking"),
  });

  const system = buildSystemPrompt(ctx);
  const tools = toolDefinitions();
  const texts: string[] = [];
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let streamedThisRound = false;
      const emit = (delta: string) => {
        if (!delta) return;
        // Separate text from consecutive rounds (e.g. a filler before a tool call).
        if (!streamedThisRound && texts.length > 0) options.onText?.(" ");
        streamedThisRound = true;
        options.onText?.(delta);
      };
      const dedupe = new RepeatFilter(texts.at(-1) ?? "", emit);
      const response = await deps.llm.stream(
        {
          tier: "realtime",
          purpose: "conversation.turn",
          system,
          messages: state.history,
          tools,
          maxTokens: 1024,
        },
        (delta) => dedupe.push(delta),
      );
      dedupe.end();
      usage.push(response.usage);
      state.history.push({ role: "assistant", content: response.content, raw: response.raw });
      const text = dedupe.strip(responseText(response));
      if (text) texts.push(text);

      if (response.stopReason !== "tool_use") {
        if (response.stopReason === "refusal" || (response.stopReason === "max_tokens" && !text)) {
          events.push({ type: "fallback", reason: response.stopReason });
        }
        break;
      }

      const results: LlmContentBlock[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const languageBefore = state.language;
        const outcome = await runTool(block.name, block.input, {
          ctx,
          services: deps.services,
          state,
        });
        events.push({
          type: "tool",
          name: block.name,
          input: block.input,
          ok: !outcome.isError,
          result: outcome.result,
        });
        if (outcome.record) events.push({ type: "record", record: outcome.record });
        if (state.language !== languageBefore)
          events.push({ type: "language", language: state.language });
        results.push({
          type: "tool_result",
          toolUseId: block.id,
          content: JSON.stringify(outcome.result),
          ...(outcome.isError ? { isError: true } : {}),
        });
      }
      // All tool results for one assistant turn go back in a single user message.
      state.history.push({ role: "user", content: results });
      // Goodbye already said alongside end_conversation: another round would only repeat it.
      const toolNames = response.content.flatMap((b) => (b.type === "tool_use" ? [b.name] : []));
      if (text && toolNames.length > 0 && toolNames.every((n) => n === "end_conversation")) break;
    }
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    events.push({ type: "fallback", reason: error.message });
    const reply = troubleMessage(state.language);
    state.history.push({ role: "assistant", content: reply });
    state.flow = "message";
    options.onText?.(reply);
    return { reply, state, events, usage, latencyMs: Date.now() - started };
  }

  let reply = texts.join(" ").trim();
  if (!reply || events.some((e) => e.type === "fallback")) {
    const fallback = troubleMessage(state.language);
    reply = reply ? `${reply} ${fallback}` : fallback;
    state.history.push({ role: "user", content: "[No reply was produced]" });
    state.history.push({ role: "assistant", content: fallback });
    options.onText?.(fallback);
  }
  return { reply, state, events, usage, latencyMs: Date.now() - started };
}
