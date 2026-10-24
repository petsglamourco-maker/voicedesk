import { createHmac } from "node:crypto";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters")
    .refine((v) => !/change-me/i.test(v), "BETTER_AUTH_SECRET is still the example placeholder"),
  /** Signs OAuth state and website chat tokens; derived from BETTER_AUTH_SECRET when unset. */
  OAUTH_STATE_SECRET: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(32).optional(),
  ),
  BETTER_AUTH_URL: z.string().url(),
  WEB_ORIGIN: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Refuse passwords from known breaches (Have I Been Pwned range API). Tests use "off". */
  PASSWORD_BREACH_CHECK: z.enum(["on", "off"]).default("on"),
  /**
   * Proxies allowed to say who the client is (X-Forwarded-For), comma-separated IPs/CIDRs.
   * Locally that's the Next.js dev server on this machine; in production, the load balancer.
   */
  TRUSTED_PROXIES: z.string().default("127.0.0.1,::1"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

/**
 * Its own key for OAuth state and website chat tokens (security audit M12): OAUTH_STATE_SECRET,
 * or one derived from BETTER_AUTH_SECRET, so the two can't be confused with each other.
 */
export function oauthStateSecretFor(env: Env): string {
  return (
    env.OAUTH_STATE_SECRET ??
    createHmac("sha256", env.BETTER_AUTH_SECRET)
      .update("voicedesk:oauth-state:v1")
      .digest("base64url")
  );
}
