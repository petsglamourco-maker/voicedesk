import { createServer } from "node:http";
import { SmtpEmailProvider } from "@voicedesk/adapters/email/smtp";
import { createLogger } from "@voicedesk/compliance/logger";
import { loadRootEnv } from "@voicedesk/config/load-env";
import { createRedisConnection, QUEUES, type SendEmailJob } from "@voicedesk/jobs";
import { Worker } from "bullmq";
import { z } from "zod";
import { createSendEmailProcessor } from "./processors/send-email";

loadRootEnv();
const env = z
  .object({
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

const workers = [
  new Worker<SendEmailJob>(QUEUES.email, createSendEmailProcessor(email, log), {
    connection,
    concurrency: 5,
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
  process.exit(0);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
