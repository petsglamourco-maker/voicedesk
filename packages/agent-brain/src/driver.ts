import type { LlmProvider } from "@voicedesk/adapters";
import type { AgentContext } from "./context";
import { runTurn, startConversation, type TurnResult } from "./engine";
import type { Lang } from "./languages";
import type { AgentServices } from "./services";
import type { ConversationState } from "./state";

/**
 * Simulated-call harness (brief §0.7): text in, text out, through exactly the same engine
 * the voice worker will use. Used by unit tests and `pnpm eval`.
 */
export class ConversationDriver {
  state!: ConversationState;
  readonly transcript: Array<{ role: "agent" | "caller"; text: string }> = [];
  readonly turns: TurnResult[] = [];

  constructor(
    private readonly deps: { llm: LlmProvider; services: AgentServices },
    private readonly ctx: AgentContext,
  ) {}

  start(options: { language?: Lang; callerPhone?: string | null } = {}): string {
    const { state, greeting } = startConversation(this.ctx, options);
    this.state = state;
    this.transcript.push({ role: "agent", text: greeting });
    return greeting;
  }

  async say(text: string): Promise<TurnResult> {
    this.transcript.push({ role: "caller", text });
    const result = await runTurn(this.deps, this.ctx, this.state, text);
    this.state = result.state;
    this.turns.push(result);
    this.transcript.push({ role: "agent", text: result.reply });
    return result;
  }

  get totalCostUsd(): number {
    return this.turns.flatMap((t) => t.usage).reduce((sum, u) => sum + u.costUsd, 0);
  }
}
