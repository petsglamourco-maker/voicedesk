import { aiPauseFor } from "@voicedesk/agent-brain";
import type { AppDeps } from "../app";
import { HttpError } from "./errors";

/** Back-office AI features stop when the AI cap is reached or AI is paused (ADR 0022). */
export async function refuseWhenAiPaused(
  deps: Pick<AppDeps, "db">,
  tenantId: string,
): Promise<void> {
  const { aiPaused } = await aiPauseFor(deps.db, tenantId);
  if (aiPaused === "cap") {
    throw new HttpError(
      409,
      "AI_CAP_REACHED",
      "This month's AI allowance is used up. See Settings → Usage & limits.",
    );
  }
  if (aiPaused === "platform") {
    throw new HttpError(409, "AI_PAUSED", "AI features are paused right now. Please try later.");
  }
}
