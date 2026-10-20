import { isVoicemailGreeting } from "@voicedesk/agent-brain";

/**
 * The first seconds of a call the assistant placed (Phase 6, ADR 0019). People usually say
 * "Hello?"; answering machines start a long greeting. Listen briefly, then either give the
 * fixed opening (with the AI disclosure) or, for voicemail, leave a short message and hang up.
 */

/** How long to listen before speaking first. */
export const LISTEN_FIRST_MS = 3000;
/** After a voicemail greeting is recognised, give it time to reach the beep. */
export const VOICEMAIL_BEEP_WAIT_MS = 4000;

export type OpenerPhase = "listening" | "opening" | "live" | "voicemail";

export interface OpenerEffects {
  /** The assistant holds its replies (true) until the opening has been said. */
  setHold(on: boolean): void;
  sayOpening(): Promise<void>;
  /** Leaves the voicemail message and ends the call. */
  leaveVoicemail(): Promise<void>;
}

export class OutboundOpener {
  private phase: OpenerPhase = "listening";
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly fx: OpenerEffects,
    private readonly listenMs: number = LISTEN_FIRST_MS,
    private readonly beepWaitMs: number = VOICEMAIL_BEEP_WAIT_MS,
  ) {}

  get state(): OpenerPhase {
    return this.phase;
  }

  /** The customer's phone was answered. */
  answered(): void {
    if (this.phase !== "listening" || this.timer) return;
    this.fx.setHold(true);
    this.timer = setTimeout(() => void this.open(), this.listenMs);
  }

  /** Speech from the customer's side (final transcripts only). */
  heard(transcript: string): void {
    if (this.phase !== "listening") return;
    if (isVoicemailGreeting(transcript)) {
      this.clear();
      this.phase = "voicemail";
      setTimeout(() => void this.fx.leaveVoicemail(), this.beepWaitMs);
      return;
    }
    // A person said something ("Hello?"): introduce ourselves straight away.
    void this.open();
  }

  private async open(): Promise<void> {
    if (this.phase !== "listening") return;
    this.clear();
    this.phase = "opening";
    await this.fx.sayOpening();
    this.phase = "live";
    this.fx.setHold(false);
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
