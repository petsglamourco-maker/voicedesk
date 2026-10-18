import type { LlmProvider } from "@voicedesk/adapters";
import {
  channelThreads,
  conversationMessages,
  conversations,
  withTenant,
  type Database,
} from "@voicedesk/db";
import { and, eq, sql } from "drizzle-orm";
import type { AgentContext } from "./context";
import { runTurn } from "./engine";
import { createConversation, persistTurn } from "./persistence";
import { createDbAgentServices, loadAgentContext, type DbServiceDeps } from "./services-db";
import type { ConversationState } from "./state";

/**
 * Text channels (Phase 4, ADR 0016): website chat, WhatsApp, email, forms. Each customer has a
 * thread per channel; the assistant answers unless a person has taken over. Same engine,
 * tools and records as every other channel.
 */

export type TextChannel = "web_chat" | "whatsapp" | "email" | "web_form";

/** After this long without messages a new conversation (and summary) starts. */
export const THREAD_IDLE_MS = 24 * 3600 * 1000;

export type ThreadRow = typeof channelThreads.$inferSelect;

export interface PublicEndpoint {
  id: string;
  tenantId: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

/** Widget key, form key or WhatsApp phone-number id → its business (no sign-in needed). */
export async function resolvePublicEndpoint(
  db: Database,
  kind: "widget" | "form" | "whatsapp",
  key: string,
): Promise<PublicEndpoint | null> {
  const result = await db.execute(
    sql`select id, tenant_id, enabled, config from app_resolve_public_endpoint(${kind}, ${key})`,
  );
  const row = (
    result.rows as Array<{
      id: string;
      tenant_id: string;
      enabled: boolean;
      config: Record<string, unknown>;
    }>
  )[0];
  return row
    ? { id: row.id, tenantId: row.tenant_id, enabled: row.enabled, config: row.config }
    : null;
}

export interface ThreadIdentity {
  tenantId: string;
  channel: TextChannel;
  /** Widget visitor id, WhatsApp number (E.164), email address, form submission id. */
  externalId: string;
  /** E.164 when the channel provides it (WhatsApp): recognises returning customers. */
  phone?: string | null;
  displayName?: string | null;
  subject?: string | null;
}

export interface OpenThread {
  thread: ThreadRow;
  conversationId: string;
  state: ConversationState;
  /** Set when this message started a new conversation: the fixed greeting with the AI disclosure. */
  greeting: string | null;
}

/**
 * Finds the customer's thread, or creates it, and its current conversation: a new one starts
 * the first time, after a day of quiet, or after the previous one ended.
 */
export async function openThread(
  db: Database,
  ctx: AgentContext,
  who: ThreadIdentity,
  now: Date = new Date(),
): Promise<OpenThread> {
  const { tenantId } = who;
  const existing = await withTenant(db, tenantId, async (tx) => {
    const [thread] = await tx
      .select()
      .from(channelThreads)
      .where(
        and(
          eq(channelThreads.tenantId, tenantId),
          eq(channelThreads.channel, who.channel),
          eq(channelThreads.externalId, who.externalId),
        ),
      );
    if (!thread?.conversationId) return { thread, conversation: undefined };
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, thread.conversationId));
    return { thread, conversation };
  });
  const fresh =
    existing.conversation &&
    existing.conversation.status === "active" &&
    now.getTime() - existing.thread.lastMessageAt.getTime() < THREAD_IDLE_MS;
  if (existing.thread && fresh) {
    return {
      thread: existing.thread,
      conversationId: existing.conversation!.id,
      state: existing.conversation!.state as unknown as ConversationState,
      greeting: null,
    };
  }
  // Close the stale conversation so it gets its summary.
  if (existing.conversation && existing.conversation.status === "active") {
    await withTenant(db, tenantId, (tx) =>
      tx
        .update(conversations)
        .set({ status: "ended", endedAt: existing.thread.lastMessageAt })
        .where(eq(conversations.id, existing.conversation!.id)),
    );
  }
  const created = await createConversation(db, ctx, {
    tenantId,
    channel: who.channel,
    callerPhone: who.phone ?? null,
  });
  const contactId = await withTenant(db, tenantId, async (tx) => {
    const [conv] = await tx
      .select({ contactId: conversations.contactId })
      .from(conversations)
      .where(eq(conversations.id, created.conversationId));
    return conv?.contactId ?? null;
  });
  const [thread] = await withTenant(db, tenantId, (tx) =>
    tx
      .insert(channelThreads)
      .values({
        tenantId,
        channel: who.channel,
        externalId: who.externalId,
        conversationId: created.conversationId,
        contactId,
        displayName: who.displayName ?? null,
        subject: who.subject ?? null,
        lastMessageAt: now,
        lastPreview: created.greeting.slice(0, 200),
      })
      .onConflictDoUpdate({
        target: [channelThreads.tenantId, channelThreads.channel, channelThreads.externalId],
        set: {
          conversationId: created.conversationId,
          ...(contactId ? { contactId } : {}),
          ...(who.displayName ? { displayName: who.displayName } : {}),
          ...(who.subject ? { subject: who.subject } : {}),
          lastMessageAt: now,
          // A new conversation goes back to the assistant.
          mode: "ai",
          needsHuman: false,
          updatedAt: now,
        },
      })
      .returning(),
  );
  return {
    thread: thread!,
    conversationId: created.conversationId,
    state: created.state,
    greeting: created.greeting,
  };
}

/** Bumps the thread after a message: preview, time, and unread count for staff. */
async function touchThread(
  db: Database,
  tenantId: string,
  threadId: string,
  preview: string,
  fromCustomer: boolean,
) {
  await withTenant(db, tenantId, (tx) =>
    tx
      .update(channelThreads)
      .set({
        lastMessageAt: new Date(),
        lastPreview: preview.slice(0, 200),
        ...(fromCustomer ? { unread: sql`${channelThreads.unread} + 1` } : {}),
        updatedAt: new Date(),
      })
      .where(eq(channelThreads.id, threadId)),
  );
}

export interface ChannelTurnDeps extends DbServiceDeps {
  llm: LlmProvider;
}

export interface ChannelTurnResult {
  threadId: string;
  conversationId: string;
  mode: "ai" | "human";
  /** Greeting with the AI disclosure, when this message started a new conversation. */
  greeting: string | null;
  /** The assistant's reply, or null when a person is handling the thread. */
  reply: string | null;
}

/**
 * One inbound customer message on a text channel. In "ai" mode the assistant answers
 * (streaming text to `onText`); in "human" mode the message just waits for the person.
 */
export async function handleInboundMessage(
  deps: ChannelTurnDeps,
  who: ThreadIdentity,
  text: string,
  options: { onText?: (delta: string) => void; now?: Date } = {},
): Promise<ChannelTurnResult> {
  const ctx = await loadAgentContext(deps.db, who.tenantId, "chat");
  const open = await openThread(deps.db, ctx, who, options.now);
  const { thread, conversationId } = open;
  if (thread.mode === "human") {
    await withTenant(deps.db, who.tenantId, (tx) =>
      tx.insert(conversationMessages).values({
        tenantId: who.tenantId,
        conversationId,
        role: "caller",
        content: text,
        language: open.state.language,
      }),
    );
    await touchThread(deps.db, who.tenantId, thread.id, text, true);
    return {
      threadId: thread.id,
      conversationId,
      mode: "human",
      greeting: open.greeting,
      reply: null,
    };
  }
  const services = createDbAgentServices(deps, {
    tenantId: who.tenantId,
    conversationId,
    businessName: ctx.businessName,
    timezone: ctx.timezone,
    handoffThreadId: thread.id,
  });
  const result = await runTurn({ llm: deps.llm, services }, ctx, open.state, text, {
    onText: options.onText,
  });
  const saved = await persistTurn(deps.db, {
    tenantId: who.tenantId,
    conversationId,
    previous: open.state,
    callerText: text,
    result,
    extraMetadata: { channel: who.channel },
  });
  if (!saved) throw new Error("conversation was updated by another message at the same time");
  await touchThread(deps.db, who.tenantId, thread.id, result.reply, true);
  return {
    threadId: thread.id,
    conversationId,
    mode: "ai",
    greeting: open.greeting,
    reply: result.reply,
  };
}

/** A person's reply from the inbox: stored like an agent message, marked as human. */
export async function recordHumanReply(
  db: Database,
  tenantId: string,
  threadId: string,
  author: { userId: string; name: string },
  text: string,
): Promise<{ conversationId: string; channel: TextChannel; externalId: string } | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [thread] = await tx
      .select()
      .from(channelThreads)
      .where(and(eq(channelThreads.id, threadId), eq(channelThreads.tenantId, tenantId)));
    if (!thread?.conversationId) return null;
    await tx.insert(conversationMessages).values({
      tenantId,
      conversationId: thread.conversationId,
      role: "agent",
      content: text,
      metadata: { human: true, authorUserId: author.userId, authorName: author.name },
    });
    await tx
      .update(channelThreads)
      .set({
        lastMessageAt: new Date(),
        lastPreview: text.slice(0, 200),
        unread: 0,
        needsHuman: false,
        updatedAt: new Date(),
      })
      .where(eq(channelThreads.id, thread.id));
    return {
      conversationId: thread.conversationId,
      channel: thread.channel as TextChannel,
      externalId: thread.externalId,
    };
  });
}

/**
 * Take over or hand back. Handing back leaves an engine note so the assistant knows what
 * the person said and carries on from there.
 */
export async function setThreadMode(
  db: Database,
  tenantId: string,
  threadId: string,
  mode: "ai" | "human",
  userId: string,
): Promise<ThreadRow | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [thread] = await tx
      .update(channelThreads)
      .set({
        mode,
        assigneeUserId: mode === "human" ? userId : null,
        needsHuman: false,
        updatedAt: new Date(),
      })
      .where(and(eq(channelThreads.id, threadId), eq(channelThreads.tenantId, tenantId)))
      .returning();
    if (!thread) return null;
    if (mode === "ai" && thread.conversationId) {
      const [conv] = await tx
        .select({ state: conversations.state })
        .from(conversations)
        .where(eq(conversations.id, thread.conversationId));
      if (conv) {
        const state = conv.state as unknown as ConversationState;
        // Messages the person and customer exchanged aren't in the assistant's history yet.
        const human = await tx
          .select({
            role: conversationMessages.role,
            content: conversationMessages.content,
            metadata: conversationMessages.metadata,
          })
          .from(conversationMessages)
          .where(eq(conversationMessages.conversationId, thread.conversationId))
          .orderBy(conversationMessages.id);
        const since = human.filter((m) => (m.metadata as { human?: boolean } | null)?.human);
        const note = since.length
          ? `[Engine note] A member of staff handled the last part of this conversation and has handed it back to you. Their messages were: ${since
              .slice(-5)
              .map((m) => JSON.stringify(m.content.slice(0, 300)))
              .join(" | ")}. Carry on from there.`
          : "[Engine note] A member of staff looked at this conversation and handed it back to you.";
        state.history.push({ role: "system", content: note });
        await tx
          .update(conversations)
          .set({ state: state as unknown as Record<string, unknown> })
          .where(eq(conversations.id, thread.conversationId));
      }
    }
    return thread;
  });
}
