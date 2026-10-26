import type {
  EmbeddingProvider,
  BillingProvider,
  PushProvider,
  VoiceTypingProvider,
  HumanCheck,
  LlmProvider,
  ObjectStorage,
  TextToSpeechProvider,
} from "@voicedesk/adapters";
import {
  ImapMailbox,
  type MailboxClient,
  type MailboxCredentials,
} from "@voicedesk/adapters/email/mailbox";
import {
  billingFromEnv,
  billingPricesFromEnv,
  pushFromEnv,
  voiceTypingFromEnv,
  embeddingsFromEnv,
  humanCheckFromEnv,
  storageFromEnv,
} from "@voicedesk/adapters/from-env";
import { createAuth, type Auth, type AuthAuditEvent, type AuthEmail } from "@voicedesk/auth";
import {
  createAppLlm,
  calendarsFromEnv,
  disconnectCalendarOf,
  recordAudit,
  SecretBox,
  type CalendarIntegrations,
  type ProviderSecrets,
} from "@voicedesk/core";
import { closeDb, createDb, withTenant, type Database } from "@voicedesk/db";
import {
  createAiQueue,
  createEmailQueue,
  createNotificationQueue,
  createChannelQueue,
  channelJobId,
  LIVE_CHANNEL,
  createKnowledgeQueue,
  createRedisConnection,
  scheduleRecrawl,
  scheduleMailboxPoll,
  type AiJob,
  type NotificationJob,
  type ChannelJob,
  type ProcessSourceJob,
} from "@voicedesk/jobs";
import { createLogger } from "@voicedesk/compliance/logger";
import { oauthStateSecretFor, type Env } from "./env";
import { whatsAppSettingsFromEnv, type WhatsAppSettings } from "./routes/whatsapp";
import { freshAuthStore, type FreshAuthStore } from "./lib/fresh-auth";
import { kvRateLimitStorage, redisKv, type Kv } from "./lib/kv";
import { bridgeLiveFromRedis } from "./lib/live";
import { sipGatewayFromEnv, type SipGateway } from "./lib/sip";
import { ttsFromEnv, voiceGatewayFromEnv, type VoiceGateway } from "./lib/voice";

export function createAuditSink(db: Database): (event: AuthAuditEvent) => Promise<void> {
  return async (event) => {
    const entry = { ...event, actorType: "user" as const, ipAddress: event.ipAddress ?? null };
    if (event.tenantId) {
      await withTenant(db, event.tenantId, (tx) => recordAudit(tx, entry));
    } else {
      await db.transaction((tx) => recordAudit(tx, entry));
    }
  };
}

const authLog = createLogger("auth");

export function createAppAuth(
  env: Env,
  db: Database,
  sendEmail: (email: AuthEmail) => Promise<void>,
  kv?: Kv,
  onMemberRemoved?: (event: { tenantId: string; userId: string }) => Promise<void>,
): Auth {
  return createAuth({
    db,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.WEB_ORIGIN, ...env.EXTRA_WEB_ORIGINS],
    sendEmail,
    audit: createAuditSink(db),
    checkBreachedPasswords: env.PASSWORD_BREACH_CHECK === "on",
    onBreachCheckUnavailable: () =>
      authLog.warn("breached-password check unavailable; password allowed"),
    ...(kv ? { rateLimitStorage: kvRateLimitStorage(kv) } : {}),
    ...(onMemberRemoved ? { onMemberRemoved } : {}),
  });
}

/** A removed member's own calendar stops being used (security audit M7). */
export function disconnectRemovedMembersCalendar(
  db: Database,
  secrets: ProviderSecrets,
  calendars: CalendarIntegrations | undefined,
) {
  return async ({ tenantId, userId }: { tenantId: string; userId: string }) => {
    await disconnectCalendarOf(db, secrets.box, calendars?.oauth ?? {}, tenantId, userId);
  };
}

/** Background work the API hands to apps/workers. Narrow so tests can fake it. */
export interface JobDispatcher {
  processSource(job: ProcessSourceJob): Promise<void>;
  scheduleRecrawl(job: ProcessSourceJob, recrawlDays: number | null | undefined): Promise<void>;
  enqueueAi(job: AiJob): Promise<void>;
  /** Customer confirmations, reminders and staff alerts (apps/workers notifications queue). */
  notify(job: NotificationJob): Promise<void>;
  /** Inbound WhatsApp/email messages for the workers to answer (deduplicated by message). */
  dispatchChannel(job: ChannelJob): Promise<void>;
  /** Starts polling a connected mailbox every minute, or stops it (`on: false`). */
  scheduleMailbox(tenantId: string, mailboxId: string, on: boolean): Promise<void>;
}

export interface Container {
  db: Database;
  auth: Auth;
  storage: ObjectStorage;
  jobs: JobDispatcher;
  /** Loaded lazily: the local model takes a few seconds to load on first use. */
  embeddings: () => Promise<EmbeddingProvider>;
  /** Routes to the AI providers switched on in platform settings (ADR 0012). */
  llm: LlmProvider & { invalidate?: () => void };
  secrets: ProviderSecrets;
  /** LiveKit voice sessions; null until LIVEKIT_* are set in .env. */
  voice?: VoiceGateway | null;
  /** Voice previews; null until ELEVENLABS_API_KEY is set. */
  tts?: TextToSpeechProvider | null;
  /** LiveKit SIP routing for phone numbers; null until LIVEKIT_* are set. */
  sip?: SipGateway | null;
  /** Calendar integrations (Phase 3): Google OAuth client and provider factory. */
  calendars?: CalendarIntegrations;
  /** WhatsApp Cloud API credentials (platform-level). */
  whatsapp?: WhatsAppSettings;
  /** Connects to a business's mailbox (tests pass a fake). */
  mailboxClient?: (creds: MailboxCredentials) => MailboxClient;
  /** Signs OAuth `state` values (the Better Auth secret). */
  oauthStateSecret: string;
  /** Recent password confirmations for sensitive admin actions (step-up re-auth). */
  freshAuth: FreshAuthStore;
  /** Short-lived security state: sign-in failures, lockouts, password re-checks. */
  kv: Kv;
  /** Security emails to account holders (lockout, new device), outside Better Auth. */
  sendAuthEmail: (email: AuthEmail) => Promise<void>;
  /** Bot check for public chat and forms; null until Turnstile keys are set. */
  humanCheck?: HumanCheck | null;
  /** Stripe billing (ADR 0023); null until STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set. */
  billing?: BillingProvider | null;
  /** Stripe Price id per paid plan (STRIPE_PRICE_*). */
  billingPrices?: Record<string, string>;
  /** Web push to phones (ADR 0024); null until VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are set. */
  push?: PushProvider | null;
  /** Voice typing (ADR 0027); null until a Deepgram key that can create tokens is set. */
  voiceTyping?: VoiceTypingProvider | null;
  /** Valkey for the API's request limits, shared by every API process. */
  rateLimitRedis?: ReturnType<typeof createRedisConnection>;
  /** Proxies whose X-Forwarded-For is believed (TRUSTED_PROXIES). */
  trustedProxies?: string[];
  checkRedis: () => Promise<boolean>;
  close: () => Promise<void>;
}

/** Production/dev wiring: background work is queued and run by apps/workers. */
export async function createContainer(env: Env, repoRoot: string): Promise<Container> {
  const db = createDb(env.DATABASE_URL);
  const redis = createRedisConnection(env.REDIS_URL);
  const emailQueue = createEmailQueue(redis);
  const knowledgeQueue = createKnowledgeQueue(redis);
  const aiQueue = createAiQueue(redis);
  const notificationQueue = createNotificationQueue(redis);
  const channelQueue = createChannelQueue(redis);
  const stopLiveBridge = await bridgeLiveFromRedis(redis.duplicate(), LIVE_CHANNEL);
  const kv = redisKv(redis);
  const sendAuthEmail = async (email: AuthEmail) => {
    await emailQueue.add(email.kind, email);
  };
  const secretsEarly: ProviderSecrets = {
    box: SecretBox.fromEnv(),
    anthropicEnvKey: process.env.ANTHROPIC_API_KEY || undefined,
  };
  const calendars = calendarsFromEnv();
  const auth = createAppAuth(
    env,
    db,
    sendAuthEmail,
    kv,
    disconnectRemovedMembersCalendar(db, secretsEarly, calendars),
  );
  const storage = storageFromEnv();
  await storage.ensureBucket();
  let embeddings: Promise<EmbeddingProvider> | undefined;
  const secrets = secretsEarly;

  return {
    db,
    auth,
    storage,
    llm: createAppLlm(db, secrets),
    secrets,
    voice: voiceGatewayFromEnv(),
    tts: await ttsFromEnv(),
    sip: sipGatewayFromEnv(),
    calendars,
    whatsapp: whatsAppSettingsFromEnv(),
    mailboxClient: (creds) => new ImapMailbox(creds),
    oauthStateSecret: oauthStateSecretFor(env),
    freshAuth: freshAuthStore(kv),
    kv,
    sendAuthEmail,
    humanCheck: await humanCheckFromEnv(),
    billing: await billingFromEnv(),
    billingPrices: billingPricesFromEnv(),
    push: await pushFromEnv(),
    voiceTyping: await voiceTypingFromEnv(),
    rateLimitRedis: redis,
    trustedProxies: env.TRUSTED_PROXIES.split(",")
      .map((p) => p.trim())
      .filter(Boolean),
    embeddings: () => (embeddings ??= embeddingsFromEnv(process.env, repoRoot)),
    jobs: {
      processSource: async (job) => {
        await knowledgeQueue.add("process", job);
      },
      scheduleRecrawl: (job, days) => scheduleRecrawl(knowledgeQueue, job, days),
      enqueueAi: async (job) => {
        await aiQueue.add(job.kind, job);
      },
      notify: async (job) => {
        await notificationQueue.add(job.kind, job);
      },
      dispatchChannel: async (job) => {
        await channelQueue.add(
          job.kind,
          job,
          job.kind === "whatsapp.inbound" ? { jobId: channelJobId(job) } : {},
        );
      },
      scheduleMailbox: (tenantId, mailboxId, on) =>
        scheduleMailboxPoll(channelQueue, on ? { tenantId, mailboxId } : null, mailboxId),
    },
    checkRedis: async () => (await redis.ping()) === "PONG",
    close: async () => {
      await Promise.all([
        emailQueue.close(),
        knowledgeQueue.close(),
        aiQueue.close(),
        notificationQueue.close(),
        channelQueue.close(),
        stopLiveBridge(),
      ]);
      redis.disconnect();
      await closeDb(db);
    },
  };
}
