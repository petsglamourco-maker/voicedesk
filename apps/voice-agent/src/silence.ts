/** Seconds of caller silence before "Are you still there?" (LiveKit `userAwayTimeout`). */
export const SILENCE_SECONDS = 12;

/**
 * Phone silence handling: the first quiet spell gets a check-in, a second one in a row gets a
 * goodbye and the call ends. Any speech from the caller resets it.
 */
export class SilenceHandler {
  private prompts = 0;

  constructor(
    private readonly actions: {
      stillThere: () => Promise<unknown>;
      goodbye: () => Promise<unknown>;
    },
  ) {}

  async onUserState(state: string): Promise<void> {
    if (state === "speaking") {
      this.prompts = 0;
      return;
    }
    if (state !== "away") return;
    this.prompts++;
    if (this.prompts === 1) await this.actions.stillThere();
    else if (this.prompts === 2) await this.actions.goodbye();
  }
}
