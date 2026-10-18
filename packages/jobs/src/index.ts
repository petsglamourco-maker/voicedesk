// Queue names, job payload types and connections shared by producers (api) and consumers (workers).
import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

export const QUEUES = {
  email: "email",
  /** Crawling, file extraction, chunking and embedding. CPU/network heavy. */
  knowledge: "knowledge",
  /** LLM background work: profile generation, conversation summaries. */
  ai: "ai",
  /** Customer confirmations and reminders (SMS/email) and staff alerts (Phase 3). */
  notifications: "notifications",
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

export interface ProcessSourceJob {
  tenantId: string;
  sourceId: string;
}

/**
 * Notification events. Producers (agent services in the API and voice worker, records actions)
 * only say what happened; the notifications worker decides who to tell and schedules reminders.
 */
export type NotificationJob =
  | {
      kind: "booking.changed";
      tenantId: string;
      bookingId: string;
      change: "created" | "moved" | "cancelled";
      /** Language of the conversation the change came from (customer messages use it). */
      language?: string;
    }
  | {
      kind: "booking.reminder";
      tenantId: string;
      bookingId: string;
      startsAt: string;
      language?: string;
    }
  | { kind: "staff.alert"; tenantId: string; record: "ticket" | "message" | "handoff"; id: string }
  | {
      kind: "transfer.context";
      tenantId: string;
      conversationId: string;
      /** The number the call is being transferred to (gets a heads-up text). */
      to: string;
      reason: string;
    };

/** BullMQ job id for a booking's reminder (so it can be moved or removed). */
export const reminderJobId = (bookingId: string) => `reminder-${bookingId}`;

export type AiJob =
  | { kind: "profile.generate"; tenantId: string; requestedBy: string | null }
  | { kind: "conversation.summarize"; tenantId: string; conversationId: string };

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

function makeQueue<T>(
  name: string,
  connection: Redis,
  options: QueueOptions,
  jobOptions: JobsOptions,
) {
  return new Queue<T>(name, {
    connection,
    defaultJobOptions: jobOptions,
    ...(options.prefix ? { prefix: options.prefix } : {}),
  });
}

export function createEmailQueue(
  connection: Redis,
  options: QueueOptions = {},
): Queue<SendEmailJob> {
  return makeQueue<SendEmailJob>(QUEUES.email, connection, options, DEFAULT_JOB_OPTIONS);
}

export function createKnowledgeQueue(
  connection: Redis,
  options: QueueOptions = {},
): Queue<ProcessSourceJob> {
  // Content problems are recorded on the source, so retries only cover crashes.
  return makeQueue<ProcessSourceJob>(QUEUES.knowledge, connection, options, {
    ...DEFAULT_JOB_OPTIONS,
    attempts: 2,
  });
}

export function createNotificationQueue(
  connection: Redis,
  options: QueueOptions = {},
): Queue<NotificationJob> {
  return makeQueue<NotificationJob>(QUEUES.notifications, connection, options, DEFAULT_JOB_OPTIONS);
}

export function createAiQueue(connection: Redis, options: QueueOptions = {}): Queue<AiJob> {
  return makeQueue<AiJob>(QUEUES.ai, connection, options, { ...DEFAULT_JOB_OPTIONS, attempts: 3 });
}

/** Scheduler id for a source's periodic recrawl. */
export const recrawlSchedulerId = (sourceId: string) => `recrawl:${sourceId}`;

/** Creates, updates or removes the periodic recrawl for a website source. */
export async function scheduleRecrawl(
  queue: Queue<ProcessSourceJob>,
  job: ProcessSourceJob,
  recrawlDays: number | null | undefined,
): Promise<void> {
  const id = recrawlSchedulerId(job.sourceId);
  if (!recrawlDays) {
    await queue.removeJobScheduler(id);
    return;
  }
  await queue.upsertJobScheduler(
    id,
    { every: recrawlDays * 24 * 3600 * 1000 },
    { name: "recrawl", data: job },
  );
}

export type { Queue, Job } from "bullmq";
export type { Redis } from "ioredis";
