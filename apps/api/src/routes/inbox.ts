import { recordHumanReply, setThreadMode, type TextChannel } from "@voicedesk/agent-brain";
import {
  channelThreads,
  contacts,
  conversationMessages,
  conversations,
  withTenant,
} from "@voicedesk/db";
import { and, asc, desc, eq, gt, ilike, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { live } from "../lib/live";
import { requireTenantAccess } from "./guards";

const params = z.object({ tenantId: z.string() });
const threadParams = params.extend({ threadId: z.string().uuid() });

/** Delivers a staff reply on the customer's channel. Website chat is live in the widget. */
export interface ChannelSender {
  send(params: {
    tenantId: string;
    threadId: string;
    channel: TextChannel;
    externalId: string;
    text: string;
    authorName: string;
  }): Promise<void>;
}

export function registerInboxRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["inbox"];

  r.get(
    "/api/tenants/:tenantId/inbox",
    {
      schema: {
        tags,
        summary: "Customer threads across website chat, WhatsApp, email and forms",
        params,
        querystring: z.object({
          filter: z.enum(["all", "unread", "needs_human", "mine"]).default("all"),
          channel: z.enum(["web_chat", "whatsapp", "email", "web_form"]).optional(),
          q: z.string().trim().max(100).optional(),
        }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "inbox:read",
      );
      const { filter, channel, q } = request.query;
      const conditions: Array<SQL | undefined> = [eq(channelThreads.tenantId, access.tenantId)];
      if (filter === "unread") conditions.push(gt(channelThreads.unread, 0));
      if (filter === "needs_human") conditions.push(eq(channelThreads.needsHuman, true));
      if (filter === "mine")
        conditions.push(eq(channelThreads.assigneeUserId, access.session.user.id));
      if (channel) conditions.push(eq(channelThreads.channel, channel));
      if (q) {
        const term = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
        conditions.push(
          or(
            ilike(channelThreads.displayName, term),
            ilike(channelThreads.externalId, term),
            ilike(contacts.fullName, term),
          ),
        );
      }
      const rows = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .select({ thread: channelThreads, contactName: contacts.fullName })
          .from(channelThreads)
          .leftJoin(contacts, eq(contacts.id, channelThreads.contactId))
          .where(and(...conditions))
          .orderBy(desc(channelThreads.lastMessageAt))
          .limit(200),
      );
      const [counts] = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .select({
            unread: sql<number>`count(*) filter (where ${channelThreads.unread} > 0)::int`,
            needsHuman: sql<number>`count(*) filter (where ${channelThreads.needsHuman})::int`,
          })
          .from(channelThreads)
          .where(eq(channelThreads.tenantId, access.tenantId)),
      );
      return {
        threads: rows.map(({ thread, contactName }) => ({
          id: thread.id,
          channel: thread.channel,
          name: contactName ?? thread.displayName ?? null,
          externalId: thread.channel === "web_chat" ? null : thread.externalId,
          subject: thread.subject,
          mode: thread.mode,
          needsHuman: thread.needsHuman,
          unread: thread.unread,
          assignedToMe: thread.assigneeUserId === access.session.user.id,
          lastMessageAt: thread.lastMessageAt,
          lastPreview: thread.lastPreview,
        })),
        counts: counts ?? { unread: 0, needsHuman: 0 },
      };
    },
  );

  r.get(
    "/api/tenants/:tenantId/inbox/:threadId",
    {
      schema: {
        tags,
        summary: "One thread: transcript, contact and records (marks it read)",
        params: threadParams,
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "inbox:read",
      );
      return withTenant(deps.db, access.tenantId, async (tx) => {
        const [thread] = await tx
          .update(channelThreads)
          .set({ unread: 0 })
          .where(
            and(
              eq(channelThreads.id, request.params.threadId),
              eq(channelThreads.tenantId, access.tenantId),
            ),
          )
          .returning();
        if (!thread) throw notFound();
        const [conversation] = thread.conversationId
          ? await tx.select().from(conversations).where(eq(conversations.id, thread.conversationId))
          : [];
        const [contact] = thread.contactId
          ? await tx.select().from(contacts).where(eq(contacts.id, thread.contactId))
          : [];
        const messages = conversation
          ? await tx
              .select({
                role: conversationMessages.role,
                content: conversationMessages.content,
                metadata: conversationMessages.metadata,
                createdAt: conversationMessages.createdAt,
              })
              .from(conversationMessages)
              .where(eq(conversationMessages.conversationId, conversation.id))
              .orderBy(asc(conversationMessages.id))
          : [];
        const state = (conversation?.state ?? {}) as {
          records?: Array<{ type: string; reference: string }>;
        };
        return {
          thread: {
            id: thread.id,
            channel: thread.channel,
            mode: thread.mode,
            needsHuman: thread.needsHuman,
            assignedToMe: thread.assigneeUserId === access.session.user.id,
            name: contact?.fullName ?? thread.displayName,
            externalId: thread.channel === "web_chat" ? null : thread.externalId,
            subject: thread.subject,
          },
          contact: contact
            ? {
                id: contact.id,
                fullName: contact.fullName,
                phone: contact.phoneE164,
                email: contact.email,
              }
            : null,
          conversation: conversation
            ? {
                id: conversation.id,
                status: conversation.status,
                summary: conversation.summary,
                records: state.records ?? [],
              }
            : null,
          messages: messages
            .filter((m) => m.role !== "event")
            .map((m) => {
              const meta = (m.metadata ?? {}) as { human?: boolean; authorName?: string };
              return {
                role: m.role,
                text: m.content,
                human: meta.human === true,
                authorName: meta.authorName ?? null,
                createdAt: m.createdAt,
              };
            }),
        };
      });
    },
  );

  async function changeMode(
    tenantId: string,
    threadId: string,
    mode: "ai" | "human",
    userId: string,
  ) {
    const thread = await setThreadMode(deps.db, tenantId, threadId, mode, userId);
    if (!thread) throw notFound();
    live.publish({ tenantId, threadId, type: "mode", mode });
    return thread;
  }

  r.post(
    "/api/tenants/:tenantId/inbox/:threadId/takeover",
    { schema: { tags, summary: "Take over from the assistant", params: threadParams } },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "inbox:reply",
      );
      const thread = await changeMode(
        access.tenantId,
        request.params.threadId,
        "human",
        access.session.user.id,
      );
      return { mode: thread.mode };
    },
  );

  r.post(
    "/api/tenants/:tenantId/inbox/:threadId/handback",
    { schema: { tags, summary: "Hand the thread back to the assistant", params: threadParams } },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "inbox:reply",
      );
      const thread = await changeMode(
        access.tenantId,
        request.params.threadId,
        "ai",
        access.session.user.id,
      );
      return { mode: thread.mode };
    },
  );

  r.post(
    "/api/tenants/:tenantId/inbox/:threadId/reply",
    {
      schema: {
        tags,
        summary: "Reply as a person (takes the thread over if the assistant had it)",
        params: threadParams,
        body: z.object({ text: z.string().trim().min(1).max(4000) }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "inbox:reply",
      );
      const [current] = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .select()
          .from(channelThreads)
          .where(
            and(
              eq(channelThreads.id, request.params.threadId),
              eq(channelThreads.tenantId, access.tenantId),
            ),
          ),
      );
      if (!current) throw notFound();
      const sender = deps.channelSenders?.[current.channel as TextChannel];
      if (!sender) {
        throw new HttpError(
          409,
          "CHANNEL_CANNOT_REPLY",
          "Replies on this channel aren't set up yet",
        );
      }
      if (current.mode !== "human") {
        await changeMode(access.tenantId, current.id, "human", access.session.user.id);
      }
      const author = {
        userId: access.session.user.id,
        name: access.session.user.name.split(" ")[0] ?? "Team",
      };
      const sent = await recordHumanReply(
        deps.db,
        access.tenantId,
        current.id,
        author,
        request.body.text,
      );
      if (!sent) throw notFound();
      await sender.send({
        tenantId: access.tenantId,
        threadId: current.id,
        channel: sent.channel,
        externalId: sent.externalId,
        text: request.body.text,
        authorName: author.name,
      });
      live.publish({
        tenantId: access.tenantId,
        threadId: current.id,
        type: "message",
        role: "agent",
        human: true,
        authorName: author.name,
        text: request.body.text,
      });
      return { sent: true };
    },
  );

  r.get(
    "/api/tenants/:tenantId/inbox/stream",
    { schema: { tags, summary: "Live inbox updates (Server-Sent Events)", params } },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "inbox:read",
      );
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      raw.write(": connected\n\n");
      const unsubscribe = live.subscribe(`tenant:${access.tenantId}`, (e) => {
        raw.write(
          `data: ${JSON.stringify({ threadId: e.threadId, type: e.type, mode: e.mode, human: e.human })}\n\n`,
        );
      });
      const keepAlive = setInterval(() => raw.write(": ping\n\n"), 25_000);
      request.raw.on("close", () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
    },
  );
}
