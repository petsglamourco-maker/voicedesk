// Builds providers from environment variables, so apps share one wiring.
import { join } from "node:path";
import type { EmailProvider } from "./email/types";
import type { EmbeddingProvider } from "./embeddings/types";
import type { HumanCheck } from "./human/types";
import type { BillingProvider } from "./billing/types";
import type { PushProvider } from "./push/types";
import type { VoiceTypingProvider } from "./speech/types";
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

/** Bot check for public pages; null (off) until both Turnstile keys are set. */
export async function humanCheckFromEnv(env: Env = process.env): Promise<HumanCheck | null> {
  if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY) return null;
  const { TurnstileHumanCheck } = await import("./human/turnstile");
  return new TurnstileHumanCheck({
    siteKey: env.TURNSTILE_SITE_KEY,
    secretKey: env.TURNSTILE_SECRET_KEY,
  });
}

/** Stripe billing (ADR 0023); null (billing off) until both keys are set. Test keys are fine. */
export async function billingFromEnv(env: Env = process.env): Promise<BillingProvider | null> {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) return null;
  const { StripeBilling } = await import("./billing/stripe");
  return new StripeBilling({
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
  });
}

/** Stripe Price id per paid plan, from .env (STRIPE_PRICE_STARTER, _GROWTH, _PRO). */
export function billingPricesFromEnv(env: Env = process.env): Record<string, string> {
  const prices: Record<string, string> = {};
  for (const plan of ["starter", "growth", "pro"]) {
    const id = env[`STRIPE_PRICE_${plan.toUpperCase()}`];
    if (id) prices[plan] = id;
    // ADR 0031: one price per currency, e.g. STRIPE_PRICE_STARTER_USD.
    for (const currency of ["eur", "usd", "cad", "aud", "nzd"]) {
      const local = env[`STRIPE_PRICE_${plan.toUpperCase()}_${currency.toUpperCase()}`];
      if (local) prices[`${plan}_${currency}`] = local;
    }
  }
  return prices;
}

/** Web push for the mobile app (ADR 0024); null (off) until the VAPID keys are set. */
export async function pushFromEnv(env: Env = process.env): Promise<PushProvider | null> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  const { WebPushProvider } = await import("./push/web-push");
  return new WebPushProvider({
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT || "mailto:security@voicedesk.invalid",
  });
}

/**
 * Voice typing (ADR 0027); null (no microphone buttons) until a Deepgram key that can create
 * short-lived tokens is set. DEEPGRAM_TYPING_KEY (Member role) keeps the call key narrower;
 * DEEPGRAM_API_KEY is used when it already has that role.
 */
export async function voiceTypingFromEnv(
  env: Env = process.env,
): Promise<VoiceTypingProvider | null> {
  const apiKey = env.DEEPGRAM_TYPING_KEY || env.DEEPGRAM_API_KEY;
  if (!apiKey) return null;
  const { DeepgramVoiceTyping } = await import("./speech/deepgram-token");
  return new DeepgramVoiceTyping({ apiKey });
}
