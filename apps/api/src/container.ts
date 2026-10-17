import type { EmbeddingProvider, LlmProvider, ObjectStorage } from "@voicedesk/adapters";
import { embeddingsFromEnv, llmFromEnv, storageFromEnv } from "@voicedesk/adapters/from-env";
import { createAuth, type Auth, type AuthAuditEvent, type AuthEmail } from "@voicedesk/auth";
import { recordAudit } from "@voicedesk/core";
import { closeDb, createDb, withTenant, type Database } from "@voicedesk/db";
import {
  createAiQueue,
  createEmailQueue,
  createKnowledgeQueue,
  createRedisConnection,
  scheduleRecrawl,
  type AiJob,
  type ProcessSourceJob,
} from "@voicedesk/jobs";
import type { Env } from "./env";

export function createAuditSink(db: Database): (event: AuthAuditEvent) => Promise<void> {
  return async (event) => {
    const entry = { ...event, actorType: "user" as const };
    if (event.tenantId) {
      await withTenant(db, event.tenantId, (tx) => recordAudit(tx, entry));
    } else {
      await db.transaction((tx) => recordAudit(tx, entry));
    }
  };
}

export function createAppAuth(
  env: Env,
  db: Database,
  sendEmail: (email: AuthEmail) => Promise<void>,
): Auth {
  return createAuth({
    db,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.WEB_ORIGIN],
    sendEmail,
    audit: createAuditSink(db),
  });
}

/** Background work the API hands to apps/workers. Narrow so tests can fake it. */
export interface JobDispatcher {
  processSource(job: ProcessSourceJob): Promise<void>;
  scheduleRecrawl(job: ProcessSourceJob, recrawlDays: number | null | undefined): Promise<void>;
  enqueueAi(job: AiJob): Promise<void>;
}

export interface Container {
  db: Database;
  auth: Auth;
  storage: ObjectStorage;
  jobs: JobDispatcher;
  /** Loaded lazily: the local model takes a few seconds to load on first use. */
  embeddings: () => Promise<EmbeddingProvider>;
  llm: LlmProvider;
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
  const auth = createAppAuth(env, db, async (email) => {
    await emailQueue.add(email.kind, email);
  });
  const storage = storageFromEnv();
  await storage.ensureBucket();
  let embeddings: Promise<EmbeddingProvider> | undefined;

  return {
    db,
    auth,
    storage,
    llm: await llmFromEnv(),
    embeddings: () => (embeddings ??= embeddingsFromEnv(process.env, repoRoot)),
    jobs: {
      processSource: async (job) => {
        await knowledgeQueue.add("process", job);
      },
      scheduleRecrawl: (job, days) => scheduleRecrawl(knowledgeQueue, job, days),
      enqueueAi: async (job) => {
        await aiQueue.add(job.kind, job);
      },
    },
    checkRedis: async () => (await redis.ping()) === "PONG",
    close: async () => {
      await Promise.all([emailQueue.close(), knowledgeQueue.close(), aiQueue.close()]);
      redis.disconnect();
      await closeDb(db);
    },
  };
}
