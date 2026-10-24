import type { createRedisConnection } from "@voicedesk/jobs";

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

const key = (sessionId: string) => `reauth:${sessionId}`;

export function redisFreshAuth(redis: ReturnType<typeof createRedisConnection>): FreshAuthStore {
  return {
    mark: async (sessionId) => {
      await redis.set(key(sessionId), "1", "EX", REAUTH_TTL_SECONDS);
    },
    isFresh: async (sessionId) => (await redis.exists(key(sessionId))) === 1,
  };
}

/** For tests and single-process use. */
export function memoryFreshAuth(now: () => number = Date.now): FreshAuthStore {
  const until = new Map<string, number>();
  return {
    mark: (sessionId) => {
      until.set(sessionId, now() + REAUTH_TTL_SECONDS * 1000);
      return Promise.resolve();
    },
    isFresh: (sessionId) => Promise.resolve((until.get(sessionId) ?? 0) > now()),
  };
}

export async function requireFreshAuth(store: FreshAuthStore, sessionId: string): Promise<void> {
  if (!(await store.isFresh(sessionId))) throw new ReauthRequiredError();
}
