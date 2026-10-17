import { createServer } from "node:http";
import { dirname } from "node:path";
import { SmtpEmailProvider } from "@voicedesk/adapters/email/smtp";
import { embeddingsFromEnv, llmFromEnv, storageFromEnv } from "@voicedesk/adapters/from-env";
import { createLogger } from "@voicedesk/compliance/logger";
import { loadRootEnv } from "@voicedesk/config/load-env";
import { closeDb, createDb } from "@voicedesk/db";
import {
  createRedisConnection,
  QUEUES,
  type AiJob,
  type ProcessSourceJob,
  type SendEmailJob,
} from "@voicedesk/jobs";
import { createSafeFetcher } from "@voicedesk/knowledge";
import { Worker } from "bullmq";
import { z } from "zod";
import { createAiProcessor } from "./processors/ai";
import { createProcessSourceProcessor } from "./processors/process-source";
import { createSendEmailProcessor } from "./processors/send-email";

const envFile = loadRootEnv();
const repoRoot = envFile ? dirname(envFile) : process.cwd();
const env = z
  .object({
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().positive(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().min(3),
    LOG_LEVEL: z.string().default("info"),
    WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(4100),
  })
  .parse(process.env);

const log = createLogger("workers", env.LOG_LEVEL);
const connection = createRedisConnection(env.REDIS_URL);
const email = new SmtpEmailProvider({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  user: env.SMTP_USER || undefined,
  password: env.SMTP_PASSWORD || undefined,
  defaultFrom: env.EMAIL_FROM,
});

const db = createDb(env.DATABASE_URL);
const storage = storageFromEnv();
await storage.ensureBucket();
const embeddings = await embeddingsFromEnv(process.env, repoRoot);
const knowledgeDeps = {
  db,
  embeddings,
  storage,
  fetch: createSafeFetcher(),
  log: {
    info: (obj: object, msg: string) => log.info(obj, msg),
    warn: (obj: object, msg: string) => log.warn(obj, msg),
  },
};

const workers = [
  new Worker<SendEmailJob>(QUEUES.email, createSendEmailProcessor(email, log), {
    connection,
    concurrency: 5,
  }),
  // One source at a time: crawling is polite and embedding is CPU-bound.
  new Worker<ProcessSourceJob>(QUEUES.knowledge, createProcessSourceProcessor(knowledgeDeps, log), {
    connection,
    concurrency: 1,
    lockDuration: 10 * 60_000,
  }),
  new Worker<AiJob>(QUEUES.ai, createAiProcessor({ db, llm: await llmFromEnv() }, log), {
    connection,
    concurrency: 2,
    lockDuration: 5 * 60_000,
  }),
];

for (const worker of workers) {
  worker.on("failed", (job, err) =>
    log.error(
      { queue: worker.name, jobId: job?.id, attempts: job?.attemptsMade, err },
      "job failed",
    ),
  );
}

// Liveness endpoint for process supervisors and the e2e test harness.
const health = createServer((_req, res) => {
  const ok = workers.every((w) => w.isRunning()) && connection.status === "ready";
  res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
  res.end(JSON.stringify({ status: ok ? "ok" : "degraded" }));
});
health.listen(env.WORKER_HEALTH_PORT, "127.0.0.1");
log.info(
  { queues: workers.map((w) => w.name), healthPort: env.WORKER_HEALTH_PORT },
  "workers started",
);

const shutdown = async () => {
  health.close();
  await Promise.all(workers.map((w) => w.close()));
  connection.disconnect();
  await closeDb(db);
  process.exit(0);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
