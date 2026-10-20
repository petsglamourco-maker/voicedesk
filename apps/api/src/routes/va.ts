import {
  AnswererError,
  answererTenants,
  assignVa,
  getPresence,
  listAnswerers,
  listVaAssignments,
  PRESENCE_STATUSES,
  removeVa,
  setAnswersCalls,
  setPresence,
} from "@voicedesk/core";
import { channelThreads, contacts, tenants, withPlatformAccess, withTenant } from "@voicedesk/db";
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
      return { answerers: await listAnswerers(deps.db, access.tenantId) };
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
      for (const b of businesses) {
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
      return { chats };
    },
  );

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
