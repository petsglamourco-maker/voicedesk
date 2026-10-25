import {
  activeHandoffFor,
  AnswererError,
  answererTenants,
  assignVa,
  claimHandoff,
  getHandoff,
  getPresence,
  moveHandoff,
  recordAudit,
  waitingHandoffs,
  listAnswerers,
  listVaAssignments,
  PRESENCE_STATUSES,
  removeVa,
  setAnswersCalls,
  setPresence,
  requireFeature,
} from "@voicedesk/core";
import type { ConversationState } from "@voicedesk/agent-brain";
import {
  agentSettings,
  channelThreads,
  contacts,
  conversationMessages,
  conversations,
  tenants,
  withPlatformAccess,
  withTenant,
  type Database,
} from "@voicedesk/db";
import { and, asc, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { live } from "../lib/live";
import { requireSession, requireTenantAccess } from "./guards";
import { requirePlatformOwner } from "./platform";

/** Human VA console (Phase 5, ADR 0018): who answers, presence, the cross-business queue. */

function answererError(error: unknown): never {
  if (error instanceof AnswererError) {
    const status = error.code === "NOT_A_MEMBER" || error.code === "TENANT_NOT_FOUND" ? 404 : 400;
    throw new HttpError(status, error.code, error.message);
  }
  throw error;
}

export function registerVaRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ---- Platform admin: VAs across businesses ----

  r.get(
    "/api/platform/vas",
    { schema: { tags: ["platform"], summary: "People who answer calls, per business" } },
    async (request) => {
      const session = await requirePlatformOwner(deps, request);
      return {
        assignments: await listVaAssignments(deps.db, session.user.id),
        tenants: await withPlatformAccess(
          deps.db,
          { actorUserId: session.user.id, reason: "list businesses for VA assignment" },
          (tx) =>
            tx
              .select({ id: tenants.id, name: tenants.name })
              .from(tenants)
              .orderBy(asc(tenants.name)),
        ),
      };
    },
  );

  r.post(
    "/api/platform/vas",
    {
      schema: {
        tags: ["platform"],
        summary: "Let someone answer calls for a business (makes them staff there)",
        body: z.object({ email: z.string().trim().email(), tenantId: z.string().uuid() }),
      },
    },
    async (request, reply) => {
      const session = await requirePlatformOwner(deps, request);
      await requireFeature(deps.db, request.body.tenantId, "va_console");
      try {
        const result = await assignVa(deps.db, session.user.id, request.body);
        return reply.code(201).send(result);
      } catch (error) {
        answererError(error);
      }
    },
  );

  r.delete(
    "/api/platform/vas/:tenantId/:userId",
    {
      schema: {
        tags: ["platform"],
        summary: "Stop a VA answering for a business",
        params: z.object({ tenantId: z.string().uuid(), userId: z.string().uuid() }),
      },
    },
    async (request, reply) => {
      const session = await requirePlatformOwner(deps, request);
      if (!(await removeVa(deps.db, session.user.id, request.params))) throw notFound();
      return reply.code(204).send();
    },
  );

  // ---- Business: which members answer calls ----

  r.get(
    "/api/tenants/:tenantId/answerers",
    {
      schema: {
        tags: ["team"],
        summary: "Members and VAs who answer handed-off calls",
        params: z.object({ tenantId: z.string() }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "members:read",
      );
      return {
        answerers: await listAnswerers(deps.db, access.tenantId),
        canCallOut: await answerersCanCallOut(deps.db, access.tenantId),
      };
    },
  );

  r.put(
    "/api/tenants/:tenantId/answerers-call-out",
    {
      schema: {
        tags: ["team"],
        summary: "Let staff and VAs who answer calls also phone customers (ADR 0022)",
        params: z.object({ tenantId: z.string() }),
        body: z.object({ on: z.boolean() }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "members:update_role",
      );
      await withTenant(deps.db, access.tenantId, async (tx) => {
        await tx
          .insert(agentSettings)
          .values({ tenantId: access.tenantId, answerersCanCallOut: request.body.on })
          .onConflictDoUpdate({
            target: agentSettings.tenantId,
            set: { answerersCanCallOut: request.body.on },
          });
        await recordAudit(tx, {
          tenantId: access.tenantId,
          actorType: "user",
          actorUserId: access.session.user.id,
          action: "team.call_out_changed",
          metadata: { on: request.body.on },
          ipAddress: request.ip ?? null,
        });
      });
      return { canCallOut: request.body.on };
    },
  );

  r.put(
    "/api/tenants/:tenantId/answerers/:userId",
    {
      schema: {
        tags: ["team"],
        summary: "Turn 'Answers calls' on or off for a member",
        params: z.object({ tenantId: z.string(), userId: z.string().uuid() }),
        body: z.object({ on: z.boolean() }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "members:update_role",
      );
      if (request.body.on) await requireFeature(deps.db, access.tenantId, "va_console");
      try {
        await setAnswersCalls(
          deps.db,
          access.tenantId,
          access.session.user.id,
          request.params.userId,
          request.body.on,
        );
      } catch (error) {
        answererError(error);
      }
      return { answerers: await listAnswerers(deps.db, access.tenantId) };
    },
  );

  // ---- The console ----

  r.get(
    "/api/va/me",
    { schema: { tags: ["va"], summary: "My status and the businesses I answer for" } },
    async (request) => {
      const session = await requireSession(deps.auth, request);
      return {
        presence: await getPresence(deps.db, session.user.id),
        businesses: await answererTenants(deps.db, session.user.id),
      };
    },
  );

  r.put(
    "/api/va/presence",
    {
      schema: {
        tags: ["va"],
        summary: "Set my status (also the console's heartbeat)",
        body: z.object({ status: z.enum(PRESENCE_STATUSES) }),
      },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request) => {
      const session = await requireSession(deps.auth, request);
      const businesses = await answererTenants(deps.db, session.user.id);
      if (businesses.length === 0 && request.body.status !== "offline") {
        throw new HttpError(403, "NOT_AN_ANSWERER", "You don't answer calls for any business");
      }
      await setPresence(deps.db, session.user.id, request.body.status);
      return { presence: request.body.status };
    },
  );

  r.get(
    "/api/va/queue",
    { schema: { tags: ["va"], summary: "What needs a person, across my businesses" } },
    async (request) => {
      const session = await requireSession(deps.auth, request);
      const businesses = await answererTenants(deps.db, session.user.id);
      const chats = [];
      const calls = [];
      let activeCall: { tenantId: string; businessName: string; handoffId: string } | null = null;
      for (const b of businesses) {
        for (const call of await waitingHandoffs(deps.db, b.tenantId, session.user.id)) {
          calls.push({ ...call, tenantId: b.tenantId, businessName: b.name });
        }
        const mine = await activeHandoffFor(deps.db, b.tenantId, session.user.id);
        if (mine) activeCall = { tenantId: b.tenantId, businessName: b.name, handoffId: mine.id };
        const rows = await withTenant(deps.db, b.tenantId, (tx) =>
          tx
            .select({ thread: channelThreads, contactName: contacts.fullName })
            .from(channelThreads)
            .leftJoin(contacts, eq(contacts.id, channelThreads.contactId))
            .where(
              and(eq(channelThreads.tenantId, b.tenantId), eq(channelThreads.needsHuman, true)),
            )
            .orderBy(desc(channelThreads.lastMessageAt))
            .limit(25),
        );
        chats.push(
          ...rows.map(({ thread, contactName }) => ({
            tenantId: b.tenantId,
            businessName: b.name,
            threadId: thread.id,
            channel: thread.channel,
            name: contactName ?? thread.displayName,
            preview: thread.subject ?? thread.lastPreview,
            lastMessageAt: thread.lastMessageAt,
            assignedToMe: thread.assigneeUserId === session.user.id,
          })),
        );
      }
      chats.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
      calls.sort(
        (a, b) =>
          Number(b.urgent) - Number(a.urgent) || a.queuedAt.getTime() - b.queuedAt.getTime(),
      );
      return { calls, activeCall, chats };
    },
  );

  // ---- Calls handed over by the assistant ----

  const handoffParams = z.object({ tenantId: z.string(), handoffId: z.string().uuid() });

  /** Members who answer calls for this business (platform VAs or opted-in staff). */
  async function requireAnswerer(tenantId: string, userId: string) {
    const answerers = await listAnswerers(deps.db, tenantId);
    if (!answerers.some((a) => a.userId === userId)) {
      throw new HttpError(403, "NOT_AN_ANSWERER", "You don't answer calls for this business");
    }
  }

  r.post(
    "/api/tenants/:tenantId/handoffs/:handoffId/answer",
    {
      schema: {
        tags: ["va"],
        summary: "Answer a call the assistant is handing over (first to answer wins)",
        params: handoffParams,
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "calls:read",
      );
      const userId = access.session.user.id;
      await requireAnswerer(access.tenantId, userId);
      if (!deps.voice) {
        throw new HttpError(
          503,
          "VOICE_NOT_CONFIGURED",
          "LiveKit is not configured on this server",
        );
      }
      const claimed = await claimHandoff(
        deps.db,
        access.tenantId,
        request.params.handoffId,
        userId,
      );
      if (!claimed) {
        throw new HttpError(
          409,
          "ALREADY_ANSWERED",
          "Someone else answered, or the caller hung up",
        );
      }
      await setPresence(deps.db, userId, "busy");
      const firstName = access.session.user.name.split(" ")[0] || "a colleague";
      const join = await deps.voice.joinCall({
        roomName: claimed.roomName,
        identity: `va-${userId}`,
        displayName: firstName,
      });
      await withTenant(deps.db, access.tenantId, (tx) =>
        recordAudit(tx, {
          tenantId: access.tenantId,
          actorType: "user",
          actorUserId: userId,
          action: "handoff.answered",
          targetType: "conversation",
          targetId: claimed.conversationId,
        }),
      );
      live.publish({ tenantId: access.tenantId, threadId: claimed.id, type: "handoff" });
      return {
        ...join,
        handoffId: claimed.id,
        context: await callContext(deps.db, access.tenantId, claimed.conversationId),
      };
    },
  );

  r.get(
    "/api/tenants/:tenantId/handoffs/:handoffId/context",
    {
      schema: {
        tags: ["va"],
        summary: "The call so far: transcript, caller, records",
        params: handoffParams,
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "calls:read",
      );
      const handoff = await getHandoff(deps.db, access.tenantId, request.params.handoffId);
      if (!handoff) throw notFound();
      return {
        status: handoff.status,
        context: await callContext(deps.db, access.tenantId, handoff.conversationId),
      };
    },
  );

  for (const [action, to, summary] of [
    ["return", "returned", "Hand the caller back to the assistant"],
    ["end", "ended", "End the call"],
  ] as const) {
    r.post(
      `/api/tenants/:tenantId/handoffs/:handoffId/${action}`,
      { schema: { tags: ["va"], summary, params: handoffParams } },
      async (request) => {
        const access = await requireTenantAccess(
          deps,
          request,
          request.params.tenantId,
          "calls:read",
        );
        const userId = access.session.user.id;
        const moved = await moveHandoff(
          deps.db,
          access.tenantId,
          request.params.handoffId,
          ["answered"],
          to,
          { by: userId },
        );
        if (!moved) throw new HttpError(409, "NOT_ON_CALL", "You're not on this call");
        if (to === "ended") await deps.voice?.endCall(moved.roomName);
        await setPresence(deps.db, userId, "available");
        await withTenant(deps.db, access.tenantId, (tx) =>
          recordAudit(tx, {
            tenantId: access.tenantId,
            actorType: "user",
            actorUserId: userId,
            action: `handoff.${to}`,
            targetType: "conversation",
            targetId: moved.conversationId,
          }),
        );
        live.publish({ tenantId: access.tenantId, threadId: moved.id, type: "handoff" });
        return { status: moved.status };
      },
    );
  }

  r.get(
    "/api/va/stream",
    { schema: { tags: ["va"], summary: "Live updates for my businesses (Server-Sent Events)" } },
    async (request, reply) => {
      const session = await requireSession(deps.auth, request);
      const businesses = await answererTenants(deps.db, session.user.id);
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      raw.write(": connected\n\n");
      const stops = businesses.map((b) =>
        live.subscribe(`tenant:${b.tenantId}`, (e) => {
          raw.write(`data: ${JSON.stringify({ tenantId: e.tenantId, type: e.type })}\n\n`);
        }),
      );
      const keepAlive = setInterval(() => raw.write(": ping\n\n"), 25_000);
      request.raw.on("close", () => {
        clearInterval(keepAlive);
        for (const stop of stops) stop();
      });
    },
  );
}

/** What the person answering sees: who's calling, what was said, what's been recorded. */
async function callContext(db: Database, tenantId: string, conversationId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!conversation) return null;
    const [contact] = conversation.contactId
      ? await tx.select().from(contacts).where(eq(contacts.id, conversation.contactId))
      : [];
    const messages = await tx
      .select({
        role: conversationMessages.role,
        content: conversationMessages.content,
        createdAt: conversationMessages.createdAt,
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
      .orderBy(asc(conversationMessages.id));
    const state = conversation.state as unknown as Partial<ConversationState>;
    return {
      conversationId,
      callerPhone: state.callerPhone ?? null,
      flow: state.flow ?? null,
      records: state.records ?? [],
      contact: contact
        ? {
            id: contact.id,
            fullName: contact.fullName,
            phone: contact.phoneE164,
            email: contact.email,
            notes: contact.notes,
          }
        : null,
      transcript: messages
        .filter((m) => m.role === "caller" || m.role === "agent")
        .map((m) => ({ role: m.role, text: m.content, at: m.createdAt })),
    };
  });
}

async function answerersCanCallOut(db: Database, tenantId: string): Promise<boolean> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ on: agentSettings.answerersCanCallOut })
      .from(agentSettings)
      .where(eq(agentSettings.tenantId, tenantId)),
  );
  return row?.on === true;
}
