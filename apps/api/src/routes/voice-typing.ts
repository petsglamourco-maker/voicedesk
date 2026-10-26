import { aiPauseFor, recordLlmUsage } from "@voicedesk/agent-brain";
import { agentSettings, userSettings, withTenant, type Database } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError } from "../lib/errors";
import { requireSession, requireTenantAccess } from "./guards";

/**
 * Voice typing (ADR 0027): a microphone button in text fields. The browser gets a 30-second
 * Deepgram token from here and streams audio straight to Deepgram; our key never leaves the
 * server. Both the business and each person can switch it off.
 */

/** Recorded per token: up to one minute of Deepgram nova-3 (the browser stops at 60 s). */
export const VOICE_TYPING_COST_USD = 0.0077;

async function personalSetting(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ on: userSettings.voiceTyping })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return row?.on ?? true;
}

async function businessSetting(db: Database, tenantId: string): Promise<boolean> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ on: agentSettings.voiceTyping })
      .from(agentSettings)
      .where(eq(agentSettings.tenantId, tenantId)),
  );
  return row?.on ?? true;
}

/** Whether this person sees the microphone in this business. */
export async function voiceTypingOn(
  deps: Pick<AppDeps, "db" | "voiceTyping">,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  if (!deps.voiceTyping) return false;
  return (await businessSetting(deps.db, tenantId)) && (await personalSetting(deps.db, userId));
}

export function registerVoiceTypingRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["voice-typing"];

  r.get(
    "/api/me/voice-typing",
    {
      schema: {
        tags,
        summary: "My voice typing preference, and whether it's available",
        response: { 200: z.object({ available: z.boolean(), on: z.boolean() }) },
      },
    },
    async (request) => {
      const session = await requireSession(deps.auth, request);
      return {
        available: Boolean(deps.voiceTyping),
        on: await personalSetting(deps.db, session.user.id),
      };
    },
  );

  r.put(
    "/api/me/voice-typing",
    {
      schema: {
        tags,
        summary: "Show or hide the microphone in text fields (for me)",
        body: z.object({ on: z.boolean() }),
      },
    },
    async (request) => {
      const session = await requireSession(deps.auth, request);
      const values = { voiceTyping: request.body.on, updatedAt: new Date() };
      await deps.db
        .insert(userSettings)
        .values({ userId: session.user.id, ...values })
        .onConflictDoUpdate({ target: userSettings.userId, set: values });
      return { on: request.body.on };
    },
  );

  r.post(
    "/api/tenants/:tenantId/voice-typing/token",
    {
      schema: {
        tags,
        summary: "A 30-second token to stream microphone audio to Deepgram (voice typing)",
        params: z.object({ tenantId: z.string() }),
        body: z.object({ language: z.enum(["en", "es", "fr", "de", "zh", "ar"]).default("en") }),
        response: {
          200: z.object({
            token: z.string(),
            expiresIn: z.number(),
            url: z.string(),
            protocol: z.literal("bearer"),
          }),
        },
      },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "tenant:read",
      );
      const provider = deps.voiceTyping;
      if (!provider || !(await voiceTypingOn(deps, access.tenantId, access.session.user.id))) {
        throw new HttpError(403, "VOICE_TYPING_OFF", "Voice typing is switched off.");
      }
      // ADR 0022: it counts against the AI allowance, so it stops when that's used up.
      if ((await aiPauseFor(deps.db, access.tenantId)).aiPaused) {
        throw new HttpError(
          403,
          "AI_PAUSED",
          "Voice typing is paused: this month's AI allowance is used up.",
        );
      }
      let grant;
      try {
        grant = await provider.grant(request.body.language);
      } catch (error) {
        request.log.warn({ err: (error as Error).message }, "voice typing token failed");
        throw new HttpError(
          503,
          "VOICE_TYPING_UNAVAILABLE",
          "Voice typing isn't available right now.",
        );
      }
      await recordLlmUsage({ db: deps.db }, access.tenantId, "voice_typing", {
        model: "deepgram-nova-3",
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: VOICE_TYPING_COST_USD,
      });
      return grant;
    },
  );
}
