import { createHmac, randomBytes } from "node:crypto";
import { isLlmAvailable } from "@voicedesk/adapters";
import {
  clearDemoLead,
  createConversation,
  createDbAgentServices,
  createDemo,
  DEMO_CHAT_TURNS,
  DEMO_VOICE_CALLS,
  DEMO_VOICE_SECONDS,
  demoOverview,
  demoSuggestions,
  demosToday,
  findDemo,
  getDemoSettings,
  loadAgentContext,
  persistTurn,
  runTurn,
  saveDemoSettings,
  useDemoAllowance,
  type ConversationState,
  type DemoRow,
} from "@voicedesk/agent-brain";
import { conversations, withTenant } from "@voicedesk/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { normaliseWebsiteUrl } from "./knowledge";
import { requirePlatformOwner } from "./platform";

/**
 * Instant demo (ADR 0029): the public /try page. A visitor's website becomes a 24-hour demo
 * business they can chat with and call from the browser. Off until the platform owner
 * switches it on; limited per visitor, per IP and per day. Nothing is ever sent from a demo:
 * its plan allows no texts or calls, and these routes pass no notification hook.
 */

const KEY_HEADER = "x-demo-key";
const IP_LIMIT_PER_HOUR = 3;

export function registerDemoRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["demos"];
  const ipHash = (ip: string) =>
    createHmac("sha256", deps.oauthStateSecret).update(`demo:${ip}`).digest("hex").slice(0, 32);

  async function demoFor(request: FastifyRequest): Promise<DemoRow> {
    const key = request.headers[KEY_HEADER];
    const demo = typeof key === "string" && key.length < 200 ? await findDemo(deps.db, key) : null;
    if (!demo) throw notFound();
    return demo;
  }
  function requireReady(demo: DemoRow) {
    if (demo.status !== "ready") {
      throw new HttpError(409, "DEMO_NOT_READY", "Your demo is still being built");
    }
  }

  r.get(
    "/api/public/demos/config",
    { schema: { tags, summary: "Whether instant demos are available, and the bot check key" } },
    async () => {
      const settings = deps.demoSettings ?? (await getDemoSettings(deps.db));
      return {
        enabled: settings.enabled && (await isLlmAvailable(deps.llm)),
        siteKey: deps.humanCheck?.siteKey ?? null,
        voice: Boolean(deps.voice),
      };
    },
  );

  r.post(
    "/api/public/demos",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags,
        summary: "Build a demo assistant from a website (24 hours; nothing is sent from it)",
        body: z.object({
          website: z.string().trim().min(3).max(300),
          businessName: z.string().trim().max(120).optional(),
          email: z.string().trim().email().max(200).optional(),
          /** Required with an email: "VoiceDesk may email me about my demo". */
          consent: z.boolean().optional(),
          human: z.string().max(2048).optional(),
        }),
      },
    },
    async (request, reply) => {
      const settings = deps.demoSettings ?? (await getDemoSettings(deps.db));
      if (!settings.enabled || !(await isLlmAvailable(deps.llm))) {
        throw new HttpError(403, "DEMOS_OFF", "Demos aren't available right now");
      }
      if (deps.humanCheck) {
        const verdict = await deps.humanCheck.verify(request.body.human ?? "", request.ip);
        if (verdict === "bot") {
          throw new HttpError(403, "HUMAN_CHECK_FAILED", "Please confirm you're not a robot");
        }
        if (verdict === "unavailable") request.log.warn("bot check unavailable; demo allowed");
      }
      if (request.body.email && !request.body.consent) {
        throw new HttpError(400, "CONSENT_REQUIRED", "Tick the box so we may email you");
      }
      const website = normaliseWebsiteUrl(request.body.website);
      const ip = ipHash(request.ip);
      if ((await deps.kv.incr(`demo:ip:${ip}`, 3600)) > IP_LIMIT_PER_HOUR) {
        throw new HttpError(429, "DEMO_LIMIT", "You've made a few demos already. Try again later.");
      }
      // The daily limit: an atomic counter first (parallel requests), then the record.
      const day = new Date().toISOString().slice(0, 10);
      const counted = await deps.kv.incr(`demo:day:${day}`, 2 * 86_400);
      if (counted > settings.dailyLimit || (await demosToday(deps.db)) >= settings.dailyLimit) {
        throw new HttpError(
          429,
          "DEMOS_FULL",
          "Today's demos are all taken. Please come back tomorrow.",
        );
      }
      const host = new URL(website).hostname.replace(/^www\./, "");
      const demo = await createDemo(deps.db, {
        website,
        businessName: request.body.businessName || host,
        email: request.body.email ?? null,
        ipHash: ip,
      });
      await deps.jobs.processSource({ tenantId: demo.tenantId, sourceId: demo.sourceId });
      return reply.status(201).send({ key: demo.key });
    },
  );

  r.get(
    "/api/public/demos/status",
    {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: { tags, summary: "How the demo is coming along (key in the X-Demo-Key header)" },
    },
    async (request) => {
      const demo = await demoFor(request);
      const ready = demo.status === "ready";
      const ctx = ready ? await loadAgentContext(deps.db, demo.tenantId, "chat") : null;
      return {
        status: demo.status,
        error: demo.error,
        businessName: ctx?.businessName ?? null,
        personaName: ctx?.personaName ?? null,
        suggestions: ready ? demoSuggestions(ctx?.profile ?? null) : [],
        chatTurnsLeft: Math.max(0, DEMO_CHAT_TURNS - demo.chatTurns),
        voiceCallsLeft: deps.voice ? Math.max(0, DEMO_VOICE_CALLS - demo.voiceCalls) : 0,
        maxSeconds: DEMO_VOICE_SECONDS,
        expiresAt: demo.expiresAt,
      };
    },
  );

  r.post(
    "/api/public/demos/chat",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags,
        summary: "Chat with the demo assistant (starts a conversation without conversationId)",
        body: z.object({
          conversationId: z.string().uuid().optional(),
          text: z.string().trim().min(1).max(500),
        }),
      },
    },
    async (request) => {
      const demo = await demoFor(request);
      requireReady(demo);
      if (!(await useDemoAllowance(deps.db, demo.tenantId, "chat"))) {
        throw new HttpError(429, "DEMO_USED_UP", "That's all the messages for this demo");
      }
      const ctx = await loadAgentContext(deps.db, demo.tenantId, "chat");
      let conversationId = request.body.conversationId;
      let previous: ConversationState;
      let greeting: string | null = null;
      if (conversationId) {
        const [row] = await withTenant(deps.db, demo.tenantId, (tx) =>
          tx
            .select()
            .from(conversations)
            .where(
              and(eq(conversations.id, conversationId!), eq(conversations.tenantId, demo.tenantId)),
            ),
        );
        if (!row) throw notFound();
        if (row.status !== "active") {
          throw new HttpError(409, "CONVERSATION_ENDED", "This conversation has ended");
        }
        previous = row.state as unknown as ConversationState;
      } else {
        const created = await createConversation(deps.db, ctx, {
          tenantId: demo.tenantId,
          channel: "test_console",
        });
        conversationId = created.conversationId;
        previous = created.state;
        greeting = created.greeting;
      }
      // No notify hook: a demo never sends confirmations or alerts.
      const services = createDbAgentServices(
        { db: deps.db, embeddings: await deps.embeddings() },
        {
          tenantId: demo.tenantId,
          conversationId,
          businessName: ctx.businessName,
          timezone: ctx.timezone,
        },
      );
      const result = await runTurn({ llm: deps.llm, services }, ctx, previous, request.body.text);
      await persistTurn(deps.db, {
        tenantId: demo.tenantId,
        conversationId,
        previous,
        callerText: request.body.text,
        result,
      });
      return { conversationId, greeting, reply: result.reply };
    },
  );

  r.post(
    "/api/public/demos/voice",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: { tags, summary: "Talk to the demo assistant in the browser (a few minutes)" },
    },
    async (request, reply) => {
      const demo = await demoFor(request);
      requireReady(demo);
      if (!deps.voice) throw new HttpError(503, "VOICE_NOT_CONFIGURED", "Voice isn't available");
      if (!(await useDemoAllowance(deps.db, demo.tenantId, "voice"))) {
        throw new HttpError(429, "DEMO_USED_UP", "That's all the calls for this demo");
      }
      const ctx = await loadAgentContext(deps.db, demo.tenantId, "voice");
      const { conversationId, greeting } = await createConversation(deps.db, ctx, {
        tenantId: demo.tenantId,
        channel: "test_console",
      });
      const roomName = `vd-${conversationId}`;
      const session = await deps.voice.createSession({
        roomName,
        identity: `demo-${randomBytes(8).toString("hex")}`,
        displayName: "Visitor",
        metadata: {
          tenantId: demo.tenantId,
          conversationId,
          demo: true,
          maxSeconds: DEMO_VOICE_SECONDS,
        },
      });
      return reply.status(201).send({
        ...session,
        conversationId,
        roomName,
        greeting,
        personaName: ctx.personaName,
        maxSeconds: DEMO_VOICE_SECONDS,
      });
    },
  );

  // ── Platform admin → Demos ─────────────────────────────────────────────────────────────

  r.get(
    "/api/platform/demos",
    {
      schema: {
        tags: ["platform"],
        summary: "Instant demos: settings, today's count, spend, leads",
      },
    },
    async (request) => {
      const session = await requirePlatformOwner(deps, request);
      return demoOverview(deps.db, session.user.id);
    },
  );

  r.put(
    "/api/platform/demos",
    {
      schema: {
        tags: ["platform"],
        summary: "Switch instant demos on or off and set the daily limit",
        body: z.object({
          enabled: z.boolean(),
          dailyLimit: z.number().int().min(1).max(200),
        }),
      },
    },
    async (request, reply) => {
      const session = await requirePlatformOwner(deps, request);
      await saveDemoSettings(deps.db, request.body, session.user.id);
      return reply.status(204).send();
    },
  );

  r.delete(
    "/api/platform/demos/:requestId/email",
    {
      schema: {
        tags: ["platform"],
        summary: "Forget a demo lead's email",
        params: z.object({ requestId: z.string().uuid() }),
      },
    },
    async (request, reply) => {
      const session = await requirePlatformOwner(deps, request);
      if (!(await clearDemoLead(deps.db, request.params.requestId, session.user.id))) {
        throw notFound();
      }
      return reply.status(204).send();
    },
  );
}
