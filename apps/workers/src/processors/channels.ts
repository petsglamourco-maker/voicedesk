import type { EmbeddingProvider, LlmProvider } from "@voicedesk/adapters";
import type { MailboxClient, MailboxCredentials } from "@voicedesk/adapters/email/mailbox";
import type { WhatsAppCloudProvider } from "@voicedesk/adapters/messaging/whatsapp-cloud";
import {
  handleInboundMessage,
  processFormSubmission,
  processInboundEmail,
  type DbServiceDeps,
} from "@voicedesk/agent-brain";
import { getMailbox, mailboxCredentials, recordMailboxPoll, type SecretBox } from "@voicedesk/core";
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
  /** Decrypts mailbox passwords; email triage is off without it. */
  box: SecretBox | null;
  mailboxClient: (creds: MailboxCredentials) => MailboxClient;
}

/** Mailboxes being polled right now (a slow poll must not overlap the next one). */
const polling = new Set<string>();

/**
 * Answers inbound WhatsApp messages with the same engine as every other channel. The first
 * reply in a new conversation carries the fixed AI disclosure greeting.
 */
export function createChannelProcessor(deps: ChannelDeps, log: Logger) {
  return async (job: Job<ChannelJob>) => {
    const data = job.data;
    if (data.kind === "email.poll") return pollMailbox(deps, log, data);
    if (data.kind === "form.submitted") return triageForm(deps, log, data);
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
    // Phase 6: when the conversation ends, the rating question follows the goodbye.
    const text = [result.greeting, result.reply, result.survey?.question]
      .filter(Boolean)
      .join("\n\n");
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

/**
 * Fetches new mail from a business's mailbox and triages each message: the assistant drafts a
 * reply (kept for approval, or sent when auto-send is on and the answer is simple).
 */
async function pollMailbox(
  deps: ChannelDeps,
  log: Logger,
  data: Extract<ChannelJob, { kind: "email.poll" }>,
) {
  if (!deps.box || polling.has(data.mailboxId)) return { skipped: true };
  const row = await getMailbox(deps.db, data.tenantId);
  if (!row || row.id !== data.mailboxId) return { skipped: true }; // disconnected meanwhile
  polling.add(row.id);
  try {
    const client = deps.mailboxClient(mailboxCredentials(deps.box, row));
    let fetched;
    try {
      fetched = await client.fetchNew(row.folder, row.lastUid, row.uidValidity);
    } catch (error) {
      await recordMailboxPoll(deps.db, row, { error: (error as Error).message });
      log.warn({ tenantId: row.tenantId, mailboxId: row.id }, "mailbox poll failed");
      return { error: true };
    }
    const outcomes: string[] = [];
    let lastUid = row.lastUid;
    for (const email of fetched.messages) {
      try {
        const outcome = await processInboundEmail(
          {
            db: deps.db,
            llm: deps.llm,
            embeddings: deps.embeddings,
            calendars: deps.calendars,
            notify: deps.notify ? (e) => deps.notify!({ ...e, tenantId: row.tenantId }) : undefined,
          },
          { tenantId: row.tenantId, autoSend: row.autoSend, client, email },
        );
        outcomes.push(outcome.status);
        if (outcome.status !== "skipped") {
          await deps.publishLive({
            tenantId: row.tenantId,
            threadId: outcome.threadId,
            type: "message",
            role: "caller",
            text: email.subject,
          });
        }
      } catch (error) {
        // One bad message must not block the mailbox: note it and move on.
        outcomes.push("failed");
        log.error(
          { tenantId: row.tenantId, mailboxId: row.id, err: (error as Error).message },
          "email triage failed",
        );
      }
      lastUid = Math.max(lastUid, email.uid);
      await recordMailboxPoll(deps.db, row, { uidValidity: fetched.uidValidity, lastUid });
    }
    await recordMailboxPoll(deps.db, row, {
      uidValidity: fetched.uidValidity,
      lastUid: Math.max(lastUid, fetched.lastUid),
    });
    if (outcomes.length) {
      log.info({ tenantId: row.tenantId, mailboxId: row.id, outcomes }, "mailbox polled");
    }
    return { outcomes };
  } finally {
    polling.delete(row.id);
  }
}

/** Triages a form submission: records, a draft reply, and a live update for the inbox. */
async function triageForm(
  deps: ChannelDeps,
  log: Logger,
  data: Extract<ChannelJob, { kind: "form.submitted" }>,
) {
  const result = await processFormSubmission(
    {
      db: deps.db,
      llm: deps.llm,
      embeddings: deps.embeddings,
      calendars: deps.calendars,
      notify: deps.notify ? (e) => deps.notify!({ ...e, tenantId: data.tenantId }) : undefined,
    },
    data.tenantId,
    data.form,
  );
  await deps.publishLive({
    tenantId: data.tenantId,
    threadId: result.threadId,
    type: "message",
    role: "caller",
    text: data.form.message.slice(0, 200),
  });
  log.info({ tenantId: data.tenantId, source: data.form.source }, "form submission triaged");
  return { threadId: result.threadId };
}
