import {
  createConversation,
  createDbAgentServices,
  LANGUAGES,
  loadAgentContext,
  normalisePhone,
  persistTurn,
  runTurn,
  type ConversationState,
} from "@voicedesk/agent-brain";
import { conversationMessages, conversations, withTenant } from "@voicedesk/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { requireTenantAccess } from "./guards";

const params = z.object({ tenantId: z.string() });
const convParams = params.extend({ conversationId: z.string().uuid() });

/** What the UI shows about the engine's state (never the raw LLM history). */
function stateView(state: ConversationState) {
  return {
    flow: state.flow,
    language: state.language,
    complaint: state.complaint,
    booking: state.booking,
    message: state.message,
    signup: state.signup ?? {},
    records: state.records,
    turns: state.turns,
  };
}

export function registerConversationRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["conversations"];

  async function loadConversation(tenantId: string, conversationId: string) {
    const [row] = await withTenant(deps.db, tenantId, (tx) =>
      tx
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId))),
    );
    if (!row) throw notFound();
    return row;
  }

  r.post(
    "/api/tenants/:tenantId/conversations",
    {
      schema: {
        tags,
        summary: "Start a test-console conversation; returns the agent's greeting",
        params,
        body: z.object({
          style: z.enum(["chat", "voice"]).default("chat"),
          language: z.enum(LANGUAGES).optional(),
          callerPhone: z.string().max(30).optional(),
        }),
      },
    },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:test",
      );
      const ctx = await loadAgentContext(deps.db, access.tenantId, request.body.style);
      const callerPhone = request.body.callerPhone
        ? normalisePhone(request.body.callerPhone, ctx.countryCode)
        : null;
      const {
        conversationId: id,
        state,
        greeting,
      } = await createConversation(deps.db, ctx, {
        tenantId: access.tenantId,
        channel: "test_console",
        language: request.body.language,
        callerPhone,
        createdBy: access.session.user.id,
      });
      return reply.status(201).send({
        id,
        greeting,
        personaName: ctx.personaName,
        hasProfile: ctx.profile !== null,
        view: stateView(state),
      });
    },
  );

  r.post(
    "/api/tenants/:tenantId/conversations/:conversationId/messages",
    {
      schema: {
        tags,
        summary:
          "Send a caller message. Streams Server-Sent Events: delta, event, done (or error).",
        params: convParams,
        body: z.object({ text: z.string().trim().min(1).max(2000) }),
      },
    },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:test",
      );
      const conversation = await loadConversation(access.tenantId, request.params.conversationId);
      if (conversation.status !== "active") {
        throw new HttpError(409, "CONVERSATION_ENDED", "This conversation has ended");
      }
      const previous = conversation.state as unknown as ConversationState;
      const style = conversation.style === "voice" ? "voice" : "chat";
      const ctx = await loadAgentContext(deps.db, access.tenantId, style);
      const embeddings = await deps.embeddings();
      const services = createDbAgentServices(
        {
          db: deps.db,
          embeddings,
          calendars: {
            box: deps.secrets.box,
            factory: deps.calendars?.factory ?? null,
            log: (msg, data) => request.log.warn(data, msg),
          },
          notify: (event) => deps.jobs.notify({ ...event, tenantId: access.tenantId }),
        },
        {
          tenantId: access.tenantId,
          conversationId: conversation.id,
          businessName: ctx.businessName,
          timezone: ctx.timezone,
        },
      );

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

      try {
        const result = await runTurn(
          { llm: deps.llm, services },
          ctx,
          previous,
          request.body.text,
          {
            onText: (text) => send("delta", { text }),
          },
        );
        for (const event of result.events) send("event", event);
        const costUsd = result.usage.reduce((s, u) => s + u.costUsd, 0);

        const saved = await persistTurn(deps.db, {
          tenantId: access.tenantId,
          conversationId: conversation.id,
          previous,
          callerText: request.body.text,
          result,
        });
        if (!saved) {
          send("error", {
            message: "Another message was processed at the same time. Please resend.",
          });
        } else {
          send("done", {
            reply: result.reply,
            latencyMs: result.latencyMs,
            costUsd,
            view: stateView(result.state),
          });
        }
      } catch (error) {
        request.log.error(
          { err: error, conversationId: conversation.id },
          "conversation turn failed",
        );
        send("error", { message: "Something went wrong. Please try again." });
      } finally {
        raw.end();
      }
    },
  );

  r.get(
    "/api/tenants/:tenantId/conversations",
    { schema: { tags, summary: "Recent test conversations", params } },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:test",
      );
      return withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .select({
            id: conversations.id,
            status: conversations.status,
            style: conversations.style,
            language: conversations.language,
            startedAt: conversations.startedAt,
            endedAt: conversations.endedAt,
            flow: sql<string>`${conversations.state}->>'flow'`,
          })
          .from(conversations)
          .where(eq(conversations.tenantId, access.tenantId))
          .orderBy(desc(conversations.startedAt))
          .limit(20),
      );
    },
  );

  r.get(
    "/api/tenants/:tenantId/conversations/:conversationId",
    { schema: { tags, summary: "Transcript, engine state and summary", params: convParams } },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:test",
      );
      const conversation = await loadConversation(access.tenantId, request.params.conversationId);
      const messages = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .select({
            role: conversationMessages.role,
            content: conversationMessages.content,
            language: conversationMessages.language,
            metadata: conversationMessages.metadata,
            createdAt: conversationMessages.createdAt,
          })
          .from(conversationMessages)
          .where(eq(conversationMessages.conversationId, conversation.id))
          .orderBy(asc(conversationMessages.id)),
      );
      return {
        id: conversation.id,
        status: conversation.status,
        style: conversation.style,
        startedAt: conversation.startedAt,
        endedAt: conversation.endedAt,
        summary: conversation.summary,
        view: stateView(conversation.state as unknown as ConversationState),
        messages,
      };
    },
  );

  r.post(
    "/api/tenants/:tenantId/conversations/:conversationId/end",
    {
      schema: {
        tags,
        summary: "End the conversation and generate its summary",
        params: convParams,
      },
    },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:test",
      );
      const conversation = await loadConversation(access.tenantId, request.params.conversationId);
      if (conversation.status === "active") {
        await withTenant(deps.db, access.tenantId, (tx) =>
          tx
            .update(conversations)
            .set({ status: "ended", endedAt: new Date() })
            .where(eq(conversations.id, conversation.id)),
        );
        if ((conversation.state as unknown as ConversationState).turns > 0) {
          await deps.jobs.enqueueAi({
            kind: "conversation.summarize",
            tenantId: access.tenantId,
            conversationId: conversation.id,
          });
        }
      }
      return reply.status(202).send({ status: "ended" });
    },
  );
}
