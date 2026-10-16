// Queue names, job payload types and connections shared by producers (api) and consumers (workers).
import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

export const QUEUES = {
  email: "email",
} as const;

export interface SendEmailJob {
  to: string;
  subject: string;
  text: string;
  html?: string;
  tenantId?: string;
  /** Logical kind for metrics, e.g. "auth.verify", "auth.invite". */
  kind: string;
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/** Redis connection suitable for Workers (BullMQ requires maxRetriesPerRequest: null). */
export function createRedisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export interface QueueOptions {
  /** Redis key prefix; tests use a unique one to stay isolated. */
  prefix?: string;
}

export function createEmailQueue(
  connection: Redis,
  options: QueueOptions = {},
): Queue<SendEmailJob> {
  return new Queue<SendEmailJob>(QUEUES.email, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
    ...(options.prefix ? { prefix: options.prefix } : {}),
  });
}

export type { Queue, Job } from "bullmq";
export type { Redis } from "ioredis";
