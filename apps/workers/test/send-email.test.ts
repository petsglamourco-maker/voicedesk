import { randomUUID } from "node:crypto";
import { MockEmailProvider } from "@voicedesk/adapters";
import { createLogger } from "@voicedesk/compliance/logger";
import { loadRootEnv, requireEnv } from "@voicedesk/config/load-env";
import {
  createEmailQueue,
  createRedisConnection,
  QUEUES,
  type Job,
  type SendEmailJob,
} from "@voicedesk/jobs";
import { QueueEvents, Worker } from "bullmq";
import { describe, expect, it } from "vitest";
import { createSendEmailProcessor } from "../src/processors/send-email";

loadRootEnv();
const log = createLogger("test", "silent");

describe("send-email processor", () => {
  it("sends via the provider with kind/tenant tags", async () => {
    const provider = new MockEmailProvider();
    const process = createSendEmailProcessor(provider, log);
    const result = await process({
      id: "1",
      data: { to: "a@example.com", subject: "S", text: "T", kind: "auth.verify", tenantId: "t1" },
    } as Job<SendEmailJob>);
    expect(result.messageId).toBe(provider.sent[0]?.id);
    expect(provider.sent[0]?.tags).toEqual({ kind: "auth.verify", tenantId: "t1" });
  });

  it("processes a job end to end through Redis", async () => {
    const connection = createRedisConnection(requireEnv("REDIS_URL"));
    // Isolated prefix so the test never competes with a locally running worker.
    const prefix = `test-${randomUUID()}`;
    const queue = createEmailQueue(connection, { prefix });
    const provider = new MockEmailProvider();
    const worker = new Worker<SendEmailJob>(QUEUES.email, createSendEmailProcessor(provider, log), {
      connection,
      prefix,
    });
    const events = new QueueEvents(QUEUES.email, { connection: connection.duplicate(), prefix });
    try {
      await events.waitUntilReady();
      const job = await queue.add("auth.invite", {
        to: "b@example.com",
        subject: "Invite",
        text: "Join",
        kind: "auth.invite",
      });
      await job.waitUntilFinished(events, 10_000);
      expect(provider.sent.map((m) => m.subject)).toEqual(["Invite"]);
    } finally {
      await worker.close();
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
      connection.disconnect();
    }
  });
});
