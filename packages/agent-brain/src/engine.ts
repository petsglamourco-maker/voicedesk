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

/** Opens a conversation: fixed greeting with the mandatory AI disclosure. */
export function startConversation(
  ctx: AgentContext,
  options: { language?: Lang; callerPhone?: string | null } = {},
): { state: ConversationState; greeting: string } {
  const language = options.language ?? ctx.defaultLanguage;
  const state = initialState(language, options.callerPhone ?? null);
  const text = greeting(language, {
    business: ctx.businessName,
    name: ctx.personaName,
    gender: ctx.persona.gender,
  });
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
  const events: TurnEvent[] = [];
  const usage: LlmUsage[] = [];
  state.turns++;

  // Cheap language detection; the model can also switch explicitly via set_language.
  const detected = detectLanguage(callerText);
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
  state.history.push({ role: "system", content: stepNote(state, localNow(ctx)) });

  const system = buildSystemPrompt(ctx);
  const tools = toolDefinitions();
  const texts: string[] = [];
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let streamedThisRound = false;
      const response = await deps.llm.stream(
        {
          tier: "realtime",
          purpose: "conversation.turn",
          system,
          messages: state.history,
          tools,
          maxTokens: 1024,
        },
        (delta) => {
          // Separate text from consecutive rounds (e.g. a filler before a tool call).
          if (!streamedThisRound && texts.length > 0) options.onText?.(" ");
          streamedThisRound = true;
          options.onText?.(delta);
        },
      );
      usage.push(response.usage);
      state.history.push({ role: "assistant", content: response.content, raw: response.raw });
      const text = responseText(response);
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
