import type { Kv } from "./kv";

/**
 * Step-up re-authentication (security audit H6): sensitive admin actions need the password
 * re-entered within the last few minutes, so a stolen or left-open session can't change
 * keys, phone routing or who runs a business.
 */
export const REAUTH_TTL_SECONDS = 5 * 60;

export interface FreshAuthStore {
  /** Records that this session's password was just confirmed. */
  mark(sessionId: string): Promise<void>;
  isFresh(sessionId: string): Promise<boolean>;
}

export class ReauthRequiredError extends Error {
  constructor() {
    super("Please enter your password again to do this.");
    this.name = "ReauthRequiredError";
  }
}

export function freshAuthStore(kv: Kv): FreshAuthStore {
  const key = (sessionId: string) => `reauth:${sessionId}`;
  return {
    mark: (sessionId) => kv.set(key(sessionId), "1", REAUTH_TTL_SECONDS),
    isFresh: async (sessionId) => (await kv.get(key(sessionId))) !== null,
  };
}

export async function requireFreshAuth(store: FreshAuthStore, sessionId: string): Promise<void> {
  if (!(await store.isFresh(sessionId))) throw new ReauthRequiredError();
}
