import { randomBytes } from "node:crypto";
import {
  greeting,
  handleInboundMessage,
  loadAgentContext,
  resolvePublicEndpoint,
  type PublicEndpoint,
} from "@voicedesk/agent-brain";
import { channelThreads, conversationMessages, withTenant } from "@voicedesk/db";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { live } from "../lib/live";
import { chatFrameHtml, WIDGET_JS } from "../lib/widget-assets";

export interface WidgetConfig {
  allowedOrigins?: string[];
  color?: string;
  title?: string;
  position?: "left" | "right";
}

const keyParams = z.object({ key: z.string().min(8).max(80) });
const visitorId = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);
/** Humans take at least this long between opening the chat and sending (bots don't). */
const MIN_TYPING_MS = 1500;

function originAllowed(
  endpoint: PublicEndpoint,
  origin: string | undefined,
  ownOrigin: string,
): boolean {
  if (!origin) return false;
  if (origin === ownOrigin) return true; // previews inside VoiceDesk
  const allowed = (endpoint.config as WidgetConfig).allowedOrigins ?? [];
  return allowed.includes(origin);
}

/**
 * Website chat widget, public side (no sign-in). Identified by the business's widget key and
 * restricted to the websites it allows; visitors hold an unguessable id for their thread.
 */
export function registerPublicChatRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["public chat"];
  const ownOrigin = deps.webOrigin ?? "http://localhost:3000";

  async function endpointFor(key: string): Promise<PublicEndpoint> {
    const endpoint = await resolvePublicEndpoint(deps.db, "widget", key);
    if (!endpoint || !endpoint.enabled) throw notFound();
    return endpoint;
  }

  async function threadFor(tenantId: string, visitor: string) {
    const [thread] = await withTenant(deps.db, tenantId, (tx) =>
      tx
        .select()
        .from(channelThreads)
        .where(
          and(
            eq(channelThreads.tenantId, tenantId),
            eq(channelThreads.channel, "web_chat"),
            eq(channelThreads.externalId, visitor),
          ),
        ),
    );
    return thread ?? null;
  }

  r.get("/api/public/widget.js", { schema: { tags, hide: true } }, async (_request, reply) =>
    reply
      .header("content-type", "application/javascript; charset=utf-8")
      .header("cache-control", "public, max-age=300")
      .send(WIDGET_JS),
  );

  r.get(
    "/api/public/chat/:key/frame",
    { schema: { tags, hide: true, params: keyParams } },
    async (request, reply) => {
      const endpoint = await endpointFor(request.params.key);
      const config = endpoint.config as WidgetConfig;
      const ctx = await loadAgentContext(deps.db, endpoint.tenantId, "chat");
      const allowed = [ownOrigin, ...(config.allowedOrigins ?? [])];
      return (
        reply
          .header("content-type", "text/html; charset=utf-8")
          // Only the business's own websites (and VoiceDesk previews) may embed the chat.
          .header("content-security-policy", `frame-ancestors ${allowed.join(" ")}`)
          .header("cache-control", "no-store")
          .send(
            chatFrameHtml({
              key: request.params.key,
              title: config.title || ctx.businessName,
              color:
                config.color && /^#[0-9a-fA-F]{6}$/.test(config.color) ? config.color : "#2563eb",
              greeting: greeting(ctx.defaultLanguage, {
                business: ctx.businessName,
                name: ctx.personaName,
                gender: ctx.persona.gender,
              }),
              placeholder: "Type your message…",
              sendLabel: "Send",
              poweredBy: "AI assistant · VoiceDesk",
            }),
          )
      );
    },
  );

  r.post(
    "/api/public/chat/:key/session",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        tags,
        summary: "Start or resume a website chat",
        params: keyParams,
        body: z.object({ visitorId: visitorId.nullish(), origin: z.string().max(200).optional() }),
      },
    },
    async (request) => {
      const endpoint = await endpointFor(request.params.key);
      if (!originAllowed(endpoint, request.body.origin, ownOrigin)) {
        throw new HttpError(
          403,
          "ORIGIN_NOT_ALLOWED",
          "This website isn't allowed to use this chat",
        );
      }
      const id = request.body.visitorId ?? randomBytes(18).toString("base64url");
      const thread = await threadFor(endpoint.tenantId, id);
      const messages = thread?.conversationId
        ? await withTenant(deps.db, endpoint.tenantId, (tx) =>
            tx
              .select({
                role: conversationMessages.role,
                content: conversationMessages.content,
                metadata: conversationMessages.metadata,
              })
              .from(conversationMessages)
              .where(eq(conversationMessages.conversationId, thread.conversationId!))
              .orderBy(asc(conversationMessages.id))
              .limit(100),
          )
        : [];
      return {
        visitorId: id,
        mode: thread?.mode ?? "ai",
        messages: messages
          .filter((m) => m.role !== "event")
          .map((m) => {
            const meta = (m.metadata ?? {}) as { human?: boolean; authorName?: string };
            return {
              role: m.role,
              text: m.content,
              authorName: meta.human ? meta.authorName : undefined,
            };
          }),
      };
    },
  );

  r.post(
    "/api/public/chat/:key/messages",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags,
        summary: "Send a message. Streams Server-Sent Events: greeting, delta, done (or error).",
        params: keyParams,
        body: z.object({
          visitorId,
          text: z.string().trim().min(1).max(1000),
          origin: z.string().max(200).optional(),
          /** Honeypot: hidden from people, filled in by naive bots. */
          website: z.string().max(200).optional(),
          typedMs: z.number().int().min(0).optional(),
        }),
      },
    },
    async (request, reply) => {
      const endpoint = await endpointFor(request.params.key);
      if (!originAllowed(endpoint, request.body.origin, ownOrigin)) {
        throw new HttpError(
          403,
          "ORIGIN_NOT_ALLOWED",
          "This website isn't allowed to use this chat",
        );
      }
      if (request.body.website || (request.body.typedMs ?? MIN_TYPING_MS) < MIN_TYPING_MS) {
        throw new HttpError(400, "REJECTED", "Message rejected");
      }
      const embeddings = await deps.embeddings();
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
        const result = await handleInboundMessage(
          {
            db: deps.db,
            llm: deps.llm,
            embeddings,
            calendars: {
              box: deps.secrets.box,
              factory: deps.calendars?.factory ?? null,
              log: (msg, data) => request.log.warn(data, msg),
            },
            notify: (event) => deps.jobs.notify({ ...event, tenantId: endpoint.tenantId }),
          },
          { tenantId: endpoint.tenantId, channel: "web_chat", externalId: request.body.visitorId },
          request.body.text,
          { onText: (text) => send("delta", { text }) },
        );
        live.publish({
          tenantId: endpoint.tenantId,
          threadId: result.threadId,
          type: "message",
          role: "caller",
          text: request.body.text,
        });
        if (result.reply) {
          live.publish({
            tenantId: endpoint.tenantId,
            threadId: result.threadId,
            type: "message",
            role: "agent",
            text: result.reply,
          });
        }
        // A survey answer has no streamed reply: send the thank-you as one piece.
        if (result.surveyAnswered && result.reply) send("delta", { text: result.reply });
        send("done", {
          mode: result.mode,
          queued: result.reply === null,
          ...(result.survey
            ? {
                survey: {
                  token: result.survey.token,
                  kind: result.survey.kind,
                  question: result.survey.shortQuestion,
                },
              }
            : {}),
        });
      } catch (error) {
        request.log.error({ err: error }, "website chat turn failed");
        send("error", { message: "Sorry, something went wrong. Please try again." });
      } finally {
        raw.end();
      }
    },
  );

  r.get(
    "/api/public/chat/:key/events",
    {
      schema: {
        tags,
        summary: "Live replies from staff (Server-Sent Events)",
        params: keyParams,
        querystring: z.object({ visitorId }),
      },
    },
    async (
      request: FastifyRequest<{ Params: { key: string }; Querystring: { visitorId: string } }>,
      reply,
    ) => {
      const endpoint = await endpointFor(request.params.key);
      const thread = await threadFor(endpoint.tenantId, request.query.visitorId);
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      raw.write(": connected\n\n");
      if (!thread) {
        // No thread yet: the widget reconnects after its first message.
        raw.end();
        return;
      }
      const unsubscribe = live.subscribe(`thread:${thread.id}`, (e) => {
        if (e.type === "message" && e.human) {
          raw.write(
            `data: ${JSON.stringify({ type: "message", human: true, text: e.text, authorName: e.authorName })}\n\n`,
          );
        }
      });
      const keepAlive = setInterval(() => raw.write(": ping\n\n"), 25_000);
      request.raw.on("close", () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
    },
  );
}
