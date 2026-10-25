"use client";

/**
 * Step-up re-authentication (security audit H6). Sensitive admin actions answer
 * 403 REAUTH_REQUIRED until the password has been confirmed in the last few minutes; the
 * mounted <ReauthPrompt> asks for it, and the action is retried once.
 */
type Prompt = () => Promise<boolean>;
let prompt: Prompt | null = null;

export function registerReauthPrompt(next: Prompt): () => void {
  prompt = next;
  return () => {
    if (prompt === next) prompt = null;
  };
}

/** Asks for the password; true once it has been confirmed. */
export function confirmPassword(): Promise<boolean> {
  return prompt ? prompt() : Promise.resolve(false);
}

export const REAUTH_REQUIRED = "REAUTH_REQUIRED";
