import {
  createConversation,
  getPersona,
  greeting,
  LANGUAGES,
  loadAgentContext,
  PERSONA_IDS,
  voiceFor,
} from "@voicedesk/agent-brain";
import { conversations, withTenant } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError } from "../lib/errors";
import { requireTenantAccess } from "./guards";

const params = z.object({ tenantId: z.string() });

function notConfigured(what: string): HttpError {
  return new HttpError(503, "VOICE_NOT_CONFIGURED", `${what} is not configured on this server`);
}

export function registerVoiceRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["voice"];

  r.post(
    "/api/tenants/:tenantId/voice/session",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags,
        summary: "Start a browser voice call with the assistant (test console)",
        params,
        body: z.object({ language: z.enum(LANGUAGES).optional() }),
        response: {
          201: z.object({
            conversationId: z.string(),
            roomName: z.string(),
            url: z.string(),
            token: z.string(),
            greeting: z.string(),
            personaName: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:test",
      );
      if (!deps.voice) throw notConfigured("Voice (LiveKit)");
      const ctx = await loadAgentContext(deps.db, access.tenantId, "voice");
      const { conversationId, greeting: text } = await createConversation(deps.db, ctx, {
        tenantId: access.tenantId,
        channel: "test_console",
        language: request.body.language,
        createdBy: access.session.user.id,
      });
      const roomName = `vd-${conversationId}`;
      try {
        const session = await deps.voice.createSession({
          roomName,
          identity: `user-${access.session.user.id}`,
          displayName: access.session.user.name,
          metadata: { tenantId: access.tenantId, conversationId },
        });
        return reply.status(201).send({
          conversationId,
          roomName,
          ...session,
          greeting: text,
          personaName: ctx.personaName,
        });
      } catch (error) {
        request.log.error({ err: error }, "voice session dispatch failed");
        await withTenant(deps.db, access.tenantId, (tx) =>
          tx
            .update(conversations)
            .set({ status: "ended", endedAt: new Date() })
            .where(eq(conversations.id, conversationId)),
        );
        throw new HttpError(502, "VOICE_UNAVAILABLE", "Could not start the voice call");
      }
    },
  );

  r.post(
    "/api/tenants/:tenantId/agent/voice-preview",
    {
      // Each preview costs a little TTS credit.
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags,
        summary: "Speak a sample greeting in a persona's voice (audio/mpeg)",
        params,
        body: z.object({
          personaId: z.enum(PERSONA_IDS as [string, ...string[]]),
          language: z.enum(LANGUAGES).default("en"),
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
      if (!deps.tts) throw notConfigured("Text-to-speech (ElevenLabs)");
      const ctx = await loadAgentContext(deps.db, access.tenantId, "voice");
      const persona = getPersona(request.body.personaId);
      const text = greeting(request.body.language, {
        business: ctx.businessName,
        name: persona.id === ctx.persona.id ? ctx.personaName : persona.defaultName,
        gender: persona.gender,
      });
      const { voiceId } = voiceFor(persona.id, ctx.voiceIds);
      const { audio, mimeType } = await deps.tts.synthesize(text, {
        voiceId,
        language: request.body.language,
      });
      return reply
        .header("content-type", mimeType)
        .header("cache-control", "no-store")
        .send(Buffer.from(audio));
    },
  );
}
