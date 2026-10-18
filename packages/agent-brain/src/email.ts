import type { InboundEmail, MailboxClient } from "@voicedesk/adapters/email/mailbox";
import {
  channelThreads,
  contacts,
  conversationMessages,
  conversations,
  withTenant,
} from "@voicedesk/db";
import { and, desc, eq } from "drizzle-orm";
import { handleInboundMessage, type ChannelTurnDeps } from "./channels";
import { toLang } from "./languages";
import { aiSignature } from "./phrases";
import { loadAgentContext } from "./services-db";
import type { ConversationState } from "./state";

/**
 * Email triage (Phase 4, ADR 0017): each new email in the business's mailbox goes through the
 * same engine; the reply is sent straight away (auto-send, simple answers only) or kept as a
 * draft in the inbox for a person to approve.
 */

export interface EmailThreadMeta {
  lastMessageId: string | null;
  references: string[];
  subject: string;
  /** The customer's address (replies go here). */
  replyTo: string;
}

/** One thread per sender and email conversation (root Message-ID). */
export function emailThreadKey(email: InboundEmail): string {
  const root =
    email.references[0] ??
    email.inReplyTo ??
    email.messageId ??
    email.subject.replace(/^(re|fwd?):\s*/i, "");
  return `${email.from.address}|${root}`;
}

export function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim() || "your message"}`;
}

export type EmailOutcome =
  | { status: "skipped"; reason: "automated" }
  | { status: "waiting"; threadId: string }
  | { status: "draft"; threadId: string; reason: "review" | "needs a person" }
  | { status: "sent"; threadId: string };

/** Records that make a reply unsuitable to send without a person looking first. */
const NEEDS_REVIEW = new Set(["ticket", "human_request", "cancellation", "reschedule"]);

export async function processInboundEmail(
  deps: ChannelTurnDeps,
  params: {
    tenantId: string;
    autoSend: boolean;
    client: Pick<MailboxClient, "send">;
    email: InboundEmail;
  },
): Promise<EmailOutcome> {
  const { email, tenantId } = params;
  if (email.automated) return { status: "skipped", reason: "automated" };

  const meta: EmailThreadMeta = {
    lastMessageId: email.messageId,
    references: [...email.references, ...(email.messageId ? [email.messageId] : [])].slice(-20),
    subject: email.subject,
    replyTo: email.from.address,
  };
  const body = [
    `Subject: ${email.subject || "(no subject)"}`,
    "",
    email.text || "(empty message)",
    ...(email.attachmentNames.length
      ? ["", `[Attachments not opened: ${email.attachmentNames.join(", ")}]`]
      : []),
  ].join("\n");

  const result = await handleInboundMessage(
    deps,
    {
      tenantId,
      channel: "email",
      externalId: emailThreadKey(email),
      displayName: email.from.name ?? email.from.address,
      subject: email.subject,
      meta: meta as unknown as Record<string, unknown>,
    },
    body,
    { draft: true },
  );
  await linkEmailContact(deps.db, tenantId, result.threadId, result.conversationId, email);
  if (result.reply === null) return { status: "waiting", threadId: result.threadId };

  const state = await withTenant(deps.db, tenantId, async (tx) => {
    const [conv] = await tx
      .select({ state: conversations.state })
      .from(conversations)
      .where(eq(conversations.id, result.conversationId));
    return conv?.state as unknown as ConversationState | undefined;
  });
  // Couldn't answer from the business's facts, or asked for a person: a person checks first.
  const unsure = result.events.some(
    (e) =>
      e.type === "tool" && (e.name === "note_unanswered_question" || e.name === "request_human"),
  );
  const sensitive = unsure || (state?.records ?? []).some((r) => NEEDS_REVIEW.has(r.type));
  if (!params.autoSend || sensitive || state?.flow === "complaint") {
    return {
      status: "draft",
      threadId: result.threadId,
      reason: sensitive || state?.flow === "complaint" ? "needs a person" : "review",
    };
  }
  await sendAssistantEmail(deps.db, tenantId, result.threadId, params.client, result.reply);
  return { status: "sent", threadId: result.threadId };
}

/**
 * Sends the assistant's reply (an approved draft, or auto-send) with the AI signature, and
 * marks the draft as sent.
 */
export async function sendAssistantEmail(
  db: ChannelTurnDeps["db"],
  tenantId: string,
  threadId: string,
  client: Pick<MailboxClient, "send">,
  text: string,
): Promise<void> {
  const ctx = await loadAgentContext(db, tenantId, "email");
  const { thread, lastDraftId, language } = await withTenant(db, tenantId, async (tx) => {
    const [thread] = await tx.select().from(channelThreads).where(eq(channelThreads.id, threadId));
    const [draft] = thread?.conversationId
      ? await tx
          .select({ id: conversationMessages.id, language: conversationMessages.language })
          .from(conversationMessages)
          .where(
            and(
              eq(conversationMessages.conversationId, thread.conversationId),
              eq(conversationMessages.role, "agent"),
            ),
          )
          .orderBy(desc(conversationMessages.id))
          .limit(1)
      : [];
    return { thread, lastDraftId: draft?.id ?? null, language: draft?.language ?? null };
  });
  if (!thread) throw new Error("thread not found");
  const signature = aiSignature(
    toLang(language, ctx.defaultLanguage),
    ctx.personaName,
    ctx.businessName,
  );
  await sendThreadEmail(client, thread.meta, ctx.businessName, text, signature);
  await withTenant(db, tenantId, async (tx) => {
    if (lastDraftId !== null) await settleDraft(tx, lastDraftId, { content: text, sent: true });
    await tx
      .update(channelThreads)
      .set({ needsHuman: false, updatedAt: new Date() })
      .where(eq(channelThreads.id, threadId));
  });
}

/**
 * Sends a staff member's reply (already saved with `recordHumanReply`), signed with their
 * name. Any draft the assistant left in the thread is set aside: a person answered instead.
 */
export async function sendStaffEmail(
  db: ChannelTurnDeps["db"],
  tenantId: string,
  threadId: string,
  client: Pick<MailboxClient, "send">,
  text: string,
  authorName: string,
): Promise<void> {
  const ctx = await loadAgentContext(db, tenantId, "email");
  const thread = await withTenant(db, tenantId, async (tx) => {
    const [thread] = await tx.select().from(channelThreads).where(eq(channelThreads.id, threadId));
    if (thread?.conversationId) {
      const agentMessages = await tx
        .select({ id: conversationMessages.id, metadata: conversationMessages.metadata })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, thread.conversationId),
            eq(conversationMessages.role, "agent"),
          ),
        );
      for (const m of agentMessages) {
        if (isPendingDraft(m.metadata)) await settleDraft(tx, m.id, { sent: false });
      }
    }
    return thread;
  });
  if (!thread) throw new Error("thread not found");
  await sendThreadEmail(
    client,
    thread.meta,
    ctx.businessName,
    text,
    `${authorName}\n${ctx.businessName}`,
  );
}

/** True for an assistant reply that is waiting for a person to approve it. */
export function isPendingDraft(metadata: unknown): boolean {
  return (metadata as { draft?: boolean } | null)?.draft === true;
}

async function sendThreadEmail(
  client: Pick<MailboxClient, "send">,
  rawMeta: unknown,
  businessName: string,
  text: string,
  signature: string,
): Promise<void> {
  const meta = rawMeta as EmailThreadMeta | null;
  if (!meta?.replyTo) throw new Error("not an email thread");
  await client.send({
    fromName: businessName,
    to: meta.replyTo,
    subject: replySubject(meta.subject),
    text: `${text}\n\n--\n${signature}`,
    inReplyTo: meta.lastMessageId,
    references: meta.references,
  });
}

type Tx = Parameters<Parameters<typeof withTenant>[2]>[0];

async function settleDraft(
  tx: Tx,
  messageId: number,
  outcome: { content?: string; sent: boolean },
): Promise<void> {
  const [msg] = await tx
    .select({ metadata: conversationMessages.metadata })
    .from(conversationMessages)
    .where(eq(conversationMessages.id, messageId));
  const when = new Date().toISOString();
  await tx
    .update(conversationMessages)
    .set({
      ...(outcome.content !== undefined ? { content: outcome.content } : {}),
      metadata: {
        ...(msg?.metadata ?? {}),
        draft: false,
        ...(outcome.sent ? { sentAt: when } : { discardedAt: when }),
      },
    })
    .where(eq(conversationMessages.id, messageId));
}

/** Links the sender to a contact by email address (creating one the first time). */
async function linkEmailContact(
  db: ChannelTurnDeps["db"],
  tenantId: string,
  threadId: string,
  conversationId: string,
  email: InboundEmail,
): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    let [contact] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.email, email.from.address)));
    if (!contact) {
      [contact] = await tx
        .insert(contacts)
        .values({ tenantId, email: email.from.address, fullName: email.from.name, source: "email" })
        .returning({ id: contacts.id });
    }
    await tx
      .update(channelThreads)
      .set({ contactId: contact!.id })
      .where(eq(channelThreads.id, threadId));
    await tx
      .update(conversations)
      .set({ contactId: contact!.id })
      .where(eq(conversations.id, conversationId));
  });
}
