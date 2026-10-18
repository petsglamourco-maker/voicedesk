import type { EmbeddingProvider, LlmProvider } from "@voicedesk/adapters";
import type { WhatsAppCloudProvider } from "@voicedesk/adapters/messaging/whatsapp-cloud";
import { handleInboundMessage, type DbServiceDeps } from "@voicedesk/agent-brain";
import type { Logger } from "@voicedesk/compliance/logger";
import type { Database } from "@voicedesk/db";
import type { ChannelJob, Job, NotificationJob } from "@voicedesk/jobs";

export interface LiveMessage {
  tenantId: string;
  threadId: string;
  type: "message";
  role: "caller" | "agent";
  text: string;
}

export interface ChannelDeps {
  db: Database;
  llm: LlmProvider;
  embeddings: EmbeddingProvider;
  calendars?: DbServiceDeps["calendars"];
  /** Queues confirmations and staff alerts (the processor adds the business id). */
  notify?: (job: NotificationJob) => Promise<void>;
  whatsapp: WhatsAppCloudProvider | null;
  /** Live inbox updates (Redis pub/sub → API → browsers). */
  publishLive: (event: LiveMessage) => Promise<void>;
}

/**
 * Answers inbound WhatsApp messages with the same engine as every other channel. The first
 * reply in a new conversation carries the fixed AI disclosure greeting.
 */
export function createChannelProcessor(deps: ChannelDeps, log: Logger) {
  return async (job: Job<ChannelJob>) => {
    const data = job.data;
    if (data.kind !== "whatsapp.inbound") return;
    const result = await handleInboundMessage(
      {
        db: deps.db,
        llm: deps.llm,
        embeddings: deps.embeddings,
        calendars: deps.calendars,
        notify: deps.notify ? (e) => deps.notify!({ ...e, tenantId: data.tenantId }) : undefined,
      },
      {
        tenantId: data.tenantId,
        channel: "whatsapp",
        externalId: data.from,
        phone: data.from,
        displayName: data.profileName,
      },
      data.text,
    );
    await deps.publishLive({
      tenantId: data.tenantId,
      threadId: result.threadId,
      type: "message",
      role: "caller",
      text: data.text,
    });
    if (deps.whatsapp) await deps.whatsapp.markRead(data.phoneNumberId, data.messageId);
    if (result.reply === null) {
      log.info({ jobId: job.id, tenantId: data.tenantId }, "whatsapp message waiting for a person");
      return { mode: result.mode };
    }
    const text = result.greeting ? `${result.greeting}\n\n${result.reply}` : result.reply;
    if (!deps.whatsapp) {
      log.warn({ tenantId: data.tenantId }, "WhatsApp isn't configured; reply not sent");
      return { mode: result.mode, sent: false };
    }
    await deps.whatsapp.sendText(data.phoneNumberId, { to: data.from, text });
    await deps.publishLive({
      tenantId: data.tenantId,
      threadId: result.threadId,
      type: "message",
      role: "agent",
      text: result.reply,
    });
    log.info({ jobId: job.id, tenantId: data.tenantId }, "whatsapp reply sent");
    return { mode: result.mode, sent: true };
  };
}
