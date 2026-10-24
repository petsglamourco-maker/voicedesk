import { randomUUID } from "node:crypto";
import { isLlmAvailable } from "@voicedesk/adapters";
import { askHelp, helpFromSearch, type HelpAnswer } from "@voicedesk/agent-brain";
import { getMembershipRole, listProviderRows, recordAudit, toView } from "@voicedesk/core";
import {
  supportRequests,
  tenants,
  user,
  withPlatformAccess,
  withTenant,
  type Database,
} from "@voicedesk/db";
import {
  HelpIndex,
  listArticles,
  suggestionsFor,
  withTenantLinks,
  articleForPage,
  type HelpRole,
} from "@voicedesk/help";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { helpSetupFacts } from "../lib/help-setup";
import { requireSession } from "./guards";
import { requirePlatformOwner } from "./platform";

/**
 * In-app Help assistant (ADR 0021): answers from the help articles (packages/help) plus
 * yes/no facts about the asker's business; "Contact support" requests for the platform owner.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** "/t/<uuid>/calls/<uuid>?x" → "/t/:tenant/calls/:id" (no ids or query strings stored). */
export function normalizePage(page: string): string {
  const path = page.split(/[?#]/)[0]!.slice(0, 200);
  return path.replace(/^\/t\/[^/]+/, "/t/:tenant").replace(UUID, ":id") || "/";
}

const chatTurn = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(4000),
});

export function registerHelpRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["help"];
  const index = new HelpIndex(listArticles(), () => deps.embeddings());
  const search = (query: string, limit: number) => index.search(query, { limit });

  /** Who's asking: their business (if they're a member) and role for this screen. */
  async function asker(
    request: Parameters<typeof requireSession>[1],
    tenantId: string | undefined,
    page: string,
  ) {
    const session = await requireSession(deps.auth, request);
    const role = tenantId ? await getMembershipRole(deps.db, session.user.id, tenantId) : null;
    if (tenantId && !role) throw notFound(); // not their business: don't reveal it exists
    const helpRole: HelpRole = page.startsWith("/platform")
      ? "platform"
      : page.startsWith("/va")
        ? "va"
        : role === "owner" || role === "admin" || role === "staff"
          ? role
          : session.user.isPlatformOwner
            ? "platform"
            : "staff";
    return { session, tenantId: role ? tenantId! : null, role: helpRole };
  }

  async function aiReadyCount(db: Database) {
    return (await listProviderRows(db))
      .map((row) => toView(row, deps.secrets))
      .filter((p) => p.enabled && p.ready).length;
  }

  r.get(
    "/api/help/suggestions",
    {
      schema: {
        tags,
        summary: "Starter questions for the screen the person is on",
        querystring: z.object({ page: z.string().max(500).default("/") }),
      },
    },
    async (request) => {
      await requireSession(deps.auth, request);
      const page = normalizePage(request.query.page);
      return {
        page: articleForPage(page)?.title ?? null,
        suggestions: suggestionsFor(page),
      };
    },
  );

  r.post(
    "/api/help/ask",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags,
        summary:
          "Ask the Help assistant. Streams Server-Sent Events: delta, done {answer, offerSupport, sources, mode}, error.",
        body: z.object({
          question: z.string().trim().min(1).max(2000),
          history: z.array(chatTurn).max(20).default([]),
          tenantId: z.string().uuid().optional(),
          page: z.string().max(500).default("/"),
        }),
      },
    },
    async (request, reply) => {
      const page = normalizePage(request.body.page);
      const who = await asker(request, request.body.tenantId, page);
      // AI answers need a business to record the cost against and a provider switched on;
      // otherwise answer from the help articles alone.
      const useAi = who.tenantId !== null && (await isLlmAvailable(deps.llm));
      const tenantId = who.tenantId;
      const businessName = tenantId
        ? await withTenant(deps.db, tenantId, async (tx) => {
            const [t] = await tx
              .select({ name: tenants.name })
              .from(tenants)
              .where(eq(tenants.id, tenantId));
            return t?.name ?? null;
          })
        : null;

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      const send = (event: string, data: unknown) =>
        raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const links = (text: string) => withTenantLinks(text, tenantId);

      try {
        let result: HelpAnswer;
        if (useAi) {
          result = await askHelp(
            {
              db: deps.db,
              llm: deps.llm,
              search,
              setup: async () =>
                helpSetupFacts(deps.db, tenantId!, { enabledReady: await aiReadyCount(deps.db) }),
            },
            {
              tenantId: tenantId!,
              userId: who.session.user.id,
              role: who.role,
              businessName,
              page,
            },
            request.body.question,
            request.body.history,
            (text) => send("delta", { text: links(text) }),
          );
        } else {
          result = helpFromSearch(await search(request.body.question, 3));
        }
        send("done", {
          answer: links(result.answer),
          offerSupport: result.offerSupport,
          sources: result.sources.map((s) => ({
            title: s.title,
            page: s.page ? links(s.page) : null,
          })),
          mode: useAi ? "ai" : "articles",
        });
      } catch (error) {
        request.log.error({ err: error }, "help answer failed");
        send("error", {
          message: "Help isn't available right now. Please try again, or contact support.",
        });
      } finally {
        raw.end();
      }
    },
  );

  r.post(
    "/api/help/support",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
      schema: {
        tags,
        summary: "Send a question to the VoiceDesk team (emailed to the platform owner)",
        body: z.object({
          message: z.string().trim().min(5).max(4000),
          page: z.string().max(500).default("/"),
          tenantId: z.string().uuid().optional(),
          /** Only when they ticked "include this conversation". */
          chat: z.array(chatTurn).max(30).optional(),
        }),
        response: { 201: z.object({ id: z.string() }) },
      },
    },
    async (request, reply) => {
      const page = normalizePage(request.body.page);
      const who = await asker(request, request.body.tenantId, page);
      const id = randomUUID();
      const row = {
        id,
        tenantId: who.tenantId,
        userId: who.session.user.id,
        page,
        message: request.body.message,
        chat: request.body.chat ?? null,
      };
      // Insert only (no RETURNING): requesters can't read support requests back (RLS).
      const write = async (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => {
        await tx.insert(supportRequests).values(row);
        await recordAudit(tx, {
          tenantId: who.tenantId,
          actorType: "user",
          actorUserId: who.session.user.id,
          action: "support.requested",
          targetType: "support_request",
          targetId: id,
        });
      };
      if (who.tenantId) await withTenant(deps.db, who.tenantId, write);
      else await deps.db.transaction(write);
      await deps.jobs.notify({ kind: "support.request", requestId: id });
      return reply.status(201).send({ id });
    },
  );

  r.get(
    "/api/platform/support-requests",
    {
      schema: {
        tags: ["platform"],
        summary: "Contact-support requests from users (newest first)",
        querystring: z.object({ status: z.enum(["open", "resolved", "all"]).default("all") }),
      },
    },
    async (request) => {
      const session = await requirePlatformOwner(deps, request);
      const rows = await withPlatformAccess(
        deps.db,
        { actorUserId: session.user.id, reason: "read support requests" },
        (tx) =>
          tx
            .select({
              request: supportRequests,
              name: user.name,
              email: user.email,
              business: tenants.name,
            })
            .from(supportRequests)
            .innerJoin(user, eq(user.id, supportRequests.userId))
            .leftJoin(tenants, eq(tenants.id, supportRequests.tenantId))
            .where(
              request.query.status === "all"
                ? undefined
                : eq(supportRequests.status, request.query.status),
            )
            .orderBy(desc(supportRequests.createdAt))
            .limit(200),
      );
      return {
        requests: rows.map((r) => ({
          id: r.request.id,
          status: r.request.status,
          page: r.request.page,
          message: r.request.message,
          chat: r.request.chat,
          createdAt: r.request.createdAt,
          resolvedAt: r.request.resolvedAt,
          from: { name: r.name, email: r.email },
          business: r.business,
        })),
      };
    },
  );

  r.patch(
    "/api/platform/support-requests/:id",
    {
      schema: {
        tags: ["platform"],
        summary: "Mark a support request resolved (or open again)",
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ status: z.enum(["open", "resolved"]) }),
      },
    },
    async (request) => {
      const session = await requirePlatformOwner(deps, request);
      const updated = await withPlatformAccess(
        deps.db,
        { actorUserId: session.user.id, reason: "resolve a support request" },
        async (tx) => {
          const [row] = await tx
            .update(supportRequests)
            .set({
              status: request.body.status,
              resolvedAt: request.body.status === "resolved" ? new Date() : null,
            })
            .where(eq(supportRequests.id, request.params.id))
            .returning({ id: supportRequests.id, status: supportRequests.status });
          return row;
        },
      );
      if (!updated) throw new HttpError(404, "NOT_FOUND", "No such support request");
      return updated;
    },
  );
}
