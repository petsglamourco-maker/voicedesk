/**
 * Phone call handoff to a person at the VA console (Phase 5, ADR 0018). Pure coordination
 * with injected effects, so the ring / hold / timeout / hand-back rules are tested without a
 * LiveKit room.
 *
 *   idle ─start()→ ringing ─personJoined()→ connected ─personLeft()→ idle (assistant again)
 *                    └─ ring timeout → phone fallback, or the assistant offers a message
 */

/** Hold message while the console rings. */
export const HOLD_EVERY_MS = 15_000;

export type HandoffPhase = "idle" | "ringing" | "connected";

export interface HandoffEffects {
  /** Saves the waiting handoff and tells the consoles; returns its id. */
  open(reason: string | null, urgent: boolean): Promise<string>;
  /** waiting → missed, only if nobody answered meanwhile. */
  markMissed(id: string): Promise<boolean>;
  /** The handoff's status once the person has left (returned / ended / answered…). */
  statusOf(id: string): Promise<string | null>;
  /** answered → returned, when the person dropped without choosing (e.g. closed the tab). */
  markReturned(id: string): Promise<void>;
  /** answered → ended, when the caller hung up while talking to the person. */
  markEnded(id: string): Promise<void>;
  sayStillConnecting(): void;
  sayThroughTo(name: string): void;
  sayNobodyFree(): void;
  sayBackWithAssistant(): void;
  transferToPhone(number: string): Promise<void>;
  /** Engine note for the assistant's next turn. */
  note(text: string): void;
  hangUp(reason: string): Promise<void>;
  /** The assistant stops (true) or resumes (false) answering the caller. */
  setHumanActive(active: boolean): void;
  log(message: string, data?: Record<string, unknown>): void;
}

export class HandoffController {
  private phase: HandoffPhase = "idle";
  private handoffId: string | null = null;
  private fallback: string | undefined;
  private hold: ReturnType<typeof setInterval> | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly fx: HandoffEffects,
    private readonly ringMs: number,
    private readonly holdEveryMs: number = HOLD_EVERY_MS,
  ) {}

  get state(): HandoffPhase {
    return this.phase;
  }

  get id(): string | null {
    return this.handoffId;
  }

  /** The assistant said "connecting you"; ring the console. */
  async start(options: { reason: string | null; urgent: boolean; fallback?: string }) {
    if (this.phase !== "idle") return;
    this.phase = "ringing";
    this.fallback = options.fallback;
    // The caller is on hold: no assistant replies while the console rings.
    this.fx.setHumanActive(true);
    try {
      this.handoffId = await this.fx.open(options.reason, options.urgent);
    } catch (error) {
      this.fx.log("opening the handoff failed", { err: String(error) });
      this.phase = "idle";
      await this.giveUp();
      return;
    }
    this.hold = setInterval(() => this.fx.sayStillConnecting(), this.holdEveryMs);
    this.timeout = setTimeout(() => void this.ringTimedOut(), this.ringMs);
  }

  /** A person joined the call from the console (identity va-<userId>). */
  personJoined(name: string): void {
    if (this.phase !== "ringing") return;
    this.clearTimers();
    this.phase = "connected";
    this.fx.sayThroughTo(name);
    this.fx.log("person joined the call");
  }

  /** The person left: back to the assistant, or the end of the call. */
  async personLeft(): Promise<void> {
    if (this.phase !== "connected" || !this.handoffId) return;
    const id = this.handoffId;
    const status = await this.fx.statusOf(id).catch(() => null);
    this.reset();
    if (status === "ended") {
      await this.fx.hangUp("ended by the person who answered");
      return;
    }
    if (status !== "returned") await this.fx.markReturned(id).catch(() => undefined);
    this.fx.note(
      status === "returned"
        ? "A member of the team spoke with the caller and handed the call back to you. You don't know what they discussed unless the caller tells you; ask if there's anything else."
        : "The call with the member of the team was cut off, so the caller is back with you. Apologise briefly and offer to help or take a message.",
    );
    this.fx.setHumanActive(false);
    this.fx.sayBackWithAssistant();
  }

  /** The call ended (caller hung up) while ringing or connected. */
  async callEnded(): Promise<void> {
    const id = this.handoffId;
    const phase = this.phase;
    this.reset();
    if (id && phase === "ringing") await this.fx.markMissed(id).catch(() => false);
    if (id && phase === "connected") await this.fx.markEnded(id).catch(() => undefined);
  }

  private async ringTimedOut(): Promise<void> {
    if (this.phase !== "ringing" || !this.handoffId) return;
    // Only if nobody answered in the meantime.
    if (!(await this.fx.markMissed(this.handoffId))) return;
    this.fx.log("nobody answered the console");
    this.reset();
    await this.giveUp();
  }

  private async giveUp(): Promise<void> {
    if (this.fallback) {
      const to = this.fallback;
      this.fallback = undefined;
      // Unmuted first: if the phone transfer fails, the assistant offers a message instead.
      this.fx.setHumanActive(false);
      await this.fx.transferToPhone(to);
      return;
    }
    this.fx.note(
      "Nobody at the business could take the call. You told the caller and offered to take a message; continue from there.",
    );
    this.fx.setHumanActive(false);
    this.fx.sayNobodyFree();
  }

  private clearTimers(): void {
    if (this.hold) clearInterval(this.hold);
    if (this.timeout) clearTimeout(this.timeout);
    this.hold = null;
    this.timeout = null;
  }

  private reset(): void {
    this.clearTimers();
    this.phase = "idle";
    this.handoffId = null;
  }
}
