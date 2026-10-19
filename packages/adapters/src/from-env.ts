// Builds providers from environment variables, so apps share one wiring.
import { join } from "node:path";
import type { EmailProvider } from "./email/types";
import type { EmbeddingProvider } from "./embeddings/types";
import type { LlmProvider } from "./llm/types";
import type { SmsProvider } from "./messaging/types";
import { MockEmbeddingProvider, MockLlmProvider } from "./mocks";
import { S3ObjectStorage } from "./storage/s3";

type Env = NodeJS.ProcessEnv;

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function storageFromEnv(env: Env = process.env): S3ObjectStorage {
  return new S3ObjectStorage({
    endpoint: env.S3_ENDPOINT || undefined,
    region: required(env, "S3_REGION"),
    accessKeyId: required(env, "S3_ACCESS_KEY_ID"),
    secretAccessKey: required(env, "S3_SECRET_ACCESS_KEY"),
    bucket: required(env, "S3_BUCKET"),
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
  });
}

/**
 * EMBEDDINGS_PROVIDER=local (default) loads the multilingual model on first use;
 * "mock" uses deterministic hashing (tests, CI).
 */
export async function embeddingsFromEnv(
  env: Env = process.env,
  repoRoot: string = process.cwd(),
): Promise<EmbeddingProvider> {
  if (env.EMBEDDINGS_PROVIDER === "mock") return new MockEmbeddingProvider();
  const { LocalEmbeddingProvider } = await import("./embeddings/local");
  return new LocalEmbeddingProvider({
    model: env.EMBEDDINGS_MODEL || undefined,
    cacheDir: env.MODELS_CACHE_DIR || join(repoRoot, ".cache", "models"),
  });
}

/**
 * LLM_PROVIDER=anthropic (default when ANTHROPIC_API_KEY is set) or "mock".
 * Model ids per tier come from LLM_MODEL_REALTIME / LLM_MODEL_REASONING.
 */
export async function llmFromEnv(env: Env = process.env): Promise<LlmProvider> {
  const provider = env.LLM_PROVIDER || (env.ANTHROPIC_API_KEY ? "anthropic" : "mock");
  if (provider === "mock") return new MockLlmProvider();
  const { AnthropicLlmProvider } = await import("./llm/anthropic");
  return new AnthropicLlmProvider({
    models: {
      realtime: env.LLM_MODEL_REALTIME || "claude-haiku-5-5",
      reasoning: env.LLM_MODEL_REASONING || "claude-sonnet-5-5",
    },
  });
}

/**
 * SMS_PROVIDER=mailpit (default): texts are delivered as emails to Mailpit, free.
 * SMS_PROVIDER=twilio / telnyx: real texts (costs money). A list such as "telnyx,twilio" tries
 * them in that order. Twilio needs TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN; Telnyx needs
 * TELNYX_API_KEY (and TELNYX_MESSAGING_PROFILE_ID for an alphanumeric sender).
 */
export async function smsFromEnv(
  email: EmailProvider,
  env: Env = process.env,
): Promise<SmsProvider> {
  const { FallbackSmsProvider, MailpitSmsProvider, TelnyxSmsProvider, TwilioSmsProvider } =
    await import("./messaging/sms");
  const names = (env.SMS_PROVIDER ?? "mailpit")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const providers: SmsProvider[] = names.map((name) => {
    switch (name) {
      case "twilio":
        return new TwilioSmsProvider({
          accountSid: required(env, "TWILIO_ACCOUNT_SID"),
          authToken: required(env, "TWILIO_AUTH_TOKEN"),
        });
      case "telnyx":
        return new TelnyxSmsProvider({
          apiKey: required(env, "TELNYX_API_KEY"),
          messagingProfileId: env.TELNYX_MESSAGING_PROFILE_ID || undefined,
        });
      case "mailpit":
        return new MailpitSmsProvider(email);
      default:
        throw new Error(`Unknown SMS_PROVIDER "${name}" (use mailpit, twilio or telnyx)`);
    }
  });
  if (providers.length === 0) return new MailpitSmsProvider(email);
  return providers.length === 1 ? providers[0]! : new FallbackSmsProvider(providers);
}
