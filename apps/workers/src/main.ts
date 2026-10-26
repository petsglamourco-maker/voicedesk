import { createServer } from "node:http";
import { dirname } from "node:path";
import { ImapMailbox } from "@voicedesk/adapters/email/mailbox";
import { ReservedDomainRouter, SmtpEmailProvider } from "@voicedesk/adapters/email/smtp";
import {
  embeddingsFromEnv,
  pushFromEnv,
  smsFromEnv,
  storageFromEnv,
} from "@voicedesk/adapters/from-env";
import { createLogger } from "@voicedesk/compliance/logger";
import { loadRootEnv } from "@voicedesk/config/load-env";
import { WhatsAppCloudProvider } from "@voicedesk/adapters/messaging/whatsapp-cloud";
import { calendarsFromEnv, createAppLlm, SecretBox } from "@voicedesk/core";
import { closeDb, createDb } from "@voicedesk/db";
import {
  createEmailQueue,
  createNotificationQueue,
  createRedisConnection,
  LIVE_CHANNEL,
  QUEUES,
  type ChannelJob,
  reminderJobId,
  scheduleDailyBriefs,
  type NotificationJob,
  type AiJob,
  type ProcessSourceJob,
  type SendEmailJob,
} from "@voicedesk/jobs";
import { createSafeFetcher } from "@voicedesk/knowledge";
import { Worker } from "bullmq";
import { z } from "zod";
import { createAiProcessor } from "./processors/ai";
import { createChannelProcessor } from "./processors/channels";
import { createNotificationProcessor } from "./processors/notifications";
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
    WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
    SMS_FROM: z.string().min(1).max(15).default("VoiceDesk"),
    MAILPIT_SMTP_HOST: z.string().default("localhost"),
    MAILPIT_SMTP_PORT: z.coerce.number().int().positive().default(1025),
  })
  .parse(process.env);

const log = createLogger("workers", env.LOG_LEVEL);
const connection = createRedisConnection(env.REDIS_URL);
const smtp = new SmtpEmailProvider({
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

// Same provider routing as the API: whatever is switched on in platform settings.
const appLlm = createAppLlm(
  db,
  { box: SecretBox.fromEnv(), anthropicEnvKey: process.env.ANTHROPIC_API_KEY || undefined },
  { log: (msg, data) => log.warn(data, msg) },
);

const emailQueue = createEmailQueue(connection);
const notificationQueue = createNotificationQueue(connection);
// Daily briefs: a 15-minute tick (each business's goes out once, after 07:30 local time).
await scheduleDailyBriefs(notificationQueue);
const box = SecretBox.fromEnv();
const whatsapp = process.env.WHATSAPP_ACCESS_TOKEN
  ? new WhatsAppCloudProvider({
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
      graphVersion: process.env.WHATSAPP_GRAPH_VERSION || undefined,
    })
  : null;
// With a real email service, reserved test/demo addresses (example.com, *.test, *.local…) and
// stand-in texts (SMS_PROVIDER=mailpit) still go to the local Mailpit: they could only bounce,
// and stand-in texts must never send customer messages to a third party.
const smtpIsLocal = /^(localhost|127\.0\.0\.1|mailpit)$/i.test(env.SMTP_HOST);
const localMail = smtpIsLocal
  ? smtp
  : new SmtpEmailProvider({
      host: env.MAILPIT_SMTP_HOST,
      port: env.MAILPIT_SMTP_PORT,
      defaultFrom: env.EMAIL_FROM,
    });
const email = smtpIsLocal ? smtp : new ReservedDomainRouter(smtp, localMail);
const sms = await smsFromEnv(localMail);

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
  new Worker<ChannelJob>(
    QUEUES.channels,
    createChannelProcessor(
      {
        db,
        llm: appLlm,
        embeddings,
        calendars: { box, factory: calendarsFromEnv().factory },
        notify: async (job) => {
          await notificationQueue.add(job.kind, job);
        },
        whatsapp,
        publishLive: async (event) => {
          await connection.publish(LIVE_CHANNEL, JSON.stringify(event));
        },
        box,
        mailboxClient: (creds) => new ImapMailbox(creds),
      },
      log,
    ),
    { connection, concurrency: 4 },
  ),
  new Worker<NotificationJob>(
    QUEUES.notifications,
    createNotificationProcessor(
      {
        db,
        sms,
        email,
        smsFrom: env.SMS_FROM,
        webOrigin: env.WEB_ORIGIN,
        push: { provider: await pushFromEnv(), box },
        whatsapp,
        reminders: {
          schedule: async (job, runAt) => {
            const id = reminderJobId(job.bookingId);
            await notificationQueue.remove(id);
            await notificationQueue.add(job.kind, job, {
              jobId: id,
              delay: Math.max(0, runAt.getTime() - Date.now()),
            });
          },
          remove: async (bookingId) => {
            await notificationQueue.remove(reminderJobId(bookingId));
          },
        },
      },
      log,
    ),
    { connection, concurrency: 5 },
  ),
  new Worker<AiJob>(
    QUEUES.ai,
    createAiProcessor(
      {
        db,
        llm: appLlm,
        webOrigin: env.WEB_ORIGIN,
        sendEmail: async (job) => {
          await emailQueue.add(job.kind, job);
        },
        notify: async (job) => {
          await notificationQueue.add(job.kind, job);
        },
      },
      log,
    ),
    {
      connection,
      concurrency: 2,
      lockDuration: 5 * 60_000,
    },
  ),
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
  await emailQueue.close();
  await notificationQueue.close();
  connection.disconnect();
  await closeDb(db);
  process.exit(0);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
