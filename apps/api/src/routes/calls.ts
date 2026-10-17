import type { ConversationState } from "@voicedesk/agent-brain";
import { can } from "@voicedesk/core";
import {
  conversationMessages,
  conversations,
  phoneNumbers,
  withTenant,
  type VoiceMetrics,
} from "@voicedesk/db";
import { and, asc, desc, eq, gte, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { notFound } from "../lib/errors";
import { requireTenantAccess } from "./guards";

const params = z.object({ tenantId: z.string() });
const callParams = params.extend({ callId: z.string().uuid() });

/** "+447700900123" → "•••• 123" for roles that can't see contact details. */
export function maskPhone(phone: string | null, visible: boolean): string | null {
  if (!phone) return null;
  return visible ? phone : `•••• ${phone.slice(-3)}`;
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

type ConversationRow = typeof conversations.$inferSelect;

function callView(row: ConversationRow, e164: string | null, showPhone: boolean) {
  const state = row.state as unknown as ConversationState;
  const summary = (row.summary ?? null) as { intent?: string; outcome?: string } | null;
  return {
    id: row.id,
    test: row.channel === "test_console",
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationSeconds: row.endedAt
      ? Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 1000)
      : null,
    language: row.language,
    flow: state.flow,
    calledNumber: e164,
    callerPhone: maskPhone(state.callerPhone ?? null, showPhone),
    callerWithheld: row.callerNumberWithheld,
    records: state.records ?? [],
    intent: summary?.intent ?? null,
    outcome: summary?.outcome ?? null,
    hasRecording: row.recordingKey !== null,
    medianLatencyMs: (row.voiceMetrics as VoiceMetrics | null)?.medianMs ?? null,
  };
}

export function registerCallRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["calls"];

  r.get(
    "/api/tenants/:tenantId/calls",
    {
      schema: {
        tags,
        summary: "Voice calls (phone and browser tests), newest first, with 7-day latency",
        params,
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "calls:read",
      );
      const showPhone = can(access.role, "contacts:read");
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      return withTenant(deps.db, access.tenantId, async (tx) => {
        const rows = await tx
          .select({ call: conversations, e164: phoneNumbers.e164 })
          .from(conversations)
          .leftJoin(phoneNumbers, eq(conversations.phoneNumberId, phoneNumbers.id))
          .where(and(eq(conversations.tenantId, access.tenantId), eq(conversations.style, "voice")))
          .orderBy(desc(conversations.startedAt))
          .limit(100);
        const recent = await tx
          .select({ metrics: conversations.voiceMetrics })
          .from(conversations)
          .where(
            and(
              eq(conversations.tenantId, access.tenantId),
              isNotNull(conversations.voiceMetrics),
              gte(conversations.startedAt, since),
            ),
          );
        const totals = recent.flatMap((c) =>
          (c.metrics?.turns ?? [])
            .map((t) => t.totalMs)
            .filter((v): v is number => typeof v === "number"),
        );
        return {
          calls: rows.map((x) => callView(x.call, x.e164, showPhone)),
          latency: {
            days: 7,
            calls: recent.length,
            turns: totals.length,
            medianMs: percentile(totals, 50),
            p90Ms: percentile(totals, 90),
          },
        };
      });
    },
  );

  r.get(
    "/api/tenants/:tenantId/calls/:callId",
    {
      schema: {
        tags,
        summary: "Call transcript, summary and per-turn latency",
        params: callParams,
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "calls:read",
      );
      const showPhone = can(access.role, "contacts:read");
      return withTenant(deps.db, access.tenantId, async (tx) => {
        const [found] = await tx
          .select({ call: conversations, e164: phoneNumbers.e164 })
          .from(conversations)
          .leftJoin(phoneNumbers, eq(conversations.phoneNumberId, phoneNumbers.id))
          .where(
            and(
              eq(conversations.id, request.params.callId),
              eq(conversations.tenantId, access.tenantId),
              eq(conversations.style, "voice"),
            ),
          );
        if (!found) throw notFound();
        const messages = await tx
          .select({
            role: conversationMessages.role,
            content: conversationMessages.content,
            language: conversationMessages.language,
            createdAt: conversationMessages.createdAt,
          })
          .from(conversationMessages)
          .where(eq(conversationMessages.conversationId, found.call.id))
          .orderBy(asc(conversationMessages.id));
        return {
          ...callView(found.call, found.e164, showPhone),
          summary: found.call.summary,
          latency: found.call.voiceMetrics,
          messages,
        };
      });
    },
  );

  r.get(
    "/api/tenants/:tenantId/calls/:callId/recording",
    { schema: { tags, summary: "Call recording (audio/wav)", params: callParams } },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "calls:read",
      );
      const [row] = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .select({ key: conversations.recordingKey })
          .from(conversations)
          .where(
            and(
              eq(conversations.id, request.params.callId),
              eq(conversations.tenantId, access.tenantId),
            ),
          ),
      );
      if (!row?.key) throw notFound();
      const audio = await deps.storage.get(row.key);
      if (!audio) throw notFound();
      return reply
        .header("content-type", "audio/wav")
        .header("cache-control", "private, no-store")
        .send(Buffer.from(audio));
    },
  );
}
