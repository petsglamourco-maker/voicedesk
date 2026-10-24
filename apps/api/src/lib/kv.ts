import type { createRedisConnection } from "@voicedesk/jobs";

/**
 * Short-lived security state (password re-checks, sign-in failures, lockouts, rate limits):
 * Valkey in the app, in memory in tests. Every key expires.
 */
export interface Kv {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Adds one and returns the new count; the expiry is set only when the key is created. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  /** Seconds until the key expires, or null if it doesn't exist. */
  ttl(key: string): Promise<number | null>;
}

export function redisKv(redis: ReturnType<typeof createRedisConnection>): Kv {
  return {
    get: (key) => redis.get(key),
    set: async (key, value, ttl) => {
      await redis.set(key, value, "EX", ttl);
    },
    del: async (key) => {
      await redis.del(key);
    },
    incr: async (key, ttl) => {
      const [[, count]] = (await redis.multi().incr(key).expire(key, ttl, "NX").exec()) as [
        [Error | null, number],
        [Error | null, number],
      ];
      return count;
    },
    ttl: async (key) => {
      const seconds = await redis.ttl(key);
      return seconds < 0 ? null : seconds;
    },
  };
}

export function memoryKv(now: () => number = Date.now): Kv {
  const store = new Map<string, { value: string; until: number }>();
  const live = (key: string) => {
    const hit = store.get(key);
    if (hit && hit.until <= now()) store.delete(key);
    return store.get(key) ?? null;
  };
  return {
    get: (key) => Promise.resolve(live(key)?.value ?? null),
    set: (key, value, ttl) => {
      store.set(key, { value, until: now() + ttl * 1000 });
      return Promise.resolve();
    },
    del: (key) => {
      store.delete(key);
      return Promise.resolve();
    },
    incr: (key, ttl) => {
      const hit = live(key);
      const count = Number(hit?.value ?? 0) + 1;
      store.set(key, { value: String(count), until: hit?.until ?? now() + ttl * 1000 });
      return Promise.resolve(count);
    },
    ttl: (key) => {
      const hit = live(key);
      return Promise.resolve(hit ? Math.ceil((hit.until - now()) / 1000) : null);
    },
  };
}

/** Better Auth's rate-limit storage on top of the shared store (fixed windows). */
export function kvRateLimitStorage(kv: Kv) {
  return {
    consume: async (key: string, rule: { window: number; max: number }) => {
      const name = `auth-rl:${key}`;
      const count = await kv.incr(name, rule.window);
      if (count <= rule.max) return { allowed: true, retryAfter: null };
      return { allowed: false, retryAfter: (await kv.ttl(name)) ?? rule.window };
    },
  };
}
