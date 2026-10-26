import type { ConversationState } from "@voicedesk/agent-brain";
import { can, recordAudit } from "@voicedesk/core";
import {
  conversationMessages,
  conversations,
  departmentMoves,
  departments,
  followUps,
  handoffs,
  phoneNumbers,
  user,
  withTenant,
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

function callView(
  row: ConversationRow,
  number: { e164: string | null; carrier: string | null; department?: string | null },
  showPhone: boolean,
) {
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
    calledNumber: number.e164,
    direction: row.direction,
    /** Phone calls: which carrier delivered it (twilio / telnyx); null for browser tests. */
    carrier: number.e164 ? (number.carrier ?? "twilio") : null,
    callerPhone: maskPhone(state.callerPhone ?? null, showPhone),
    callerWithheld: row.callerNumberWithheld,
    records: state.records ?? [],
    intent: summary?.intent ?? null,
    outcome: summary?.outcome ?? null,
    hasRecording: row.recordingKey !== null,
    medianLatencyMs: row.voiceMetrics?.medianMs ?? null,
    /** ADR 0025: the caller's department, and whether the team missed the call first. */
    departmentId: row.departmentId,
    department: number.department ?? null,
    missedByTeam: row.entry === "forwarded" || row.entry === "backup",
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
        querystring: z.object({ department: z.string().uuid().optional() }),
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
          .select({
            call: conversations,
            e164: phoneNumbers.e164,
            carrier: phoneNumbers.provider,
            department: departments.name,
          })
          .from(conversations)
          .leftJoin(phoneNumbers, eq(conversations.phoneNumberId, phoneNumbers.id))
          .leftJoin(departments, eq(conversations.departmentId, departments.id))
          .where(
            and(
              eq(conversations.tenantId, access.tenantId),
              eq(conversations.style, "voice"),
              request.query.department
                ? eq(conversations.departmentId, request.query.department)
                : undefined,
            ),
          )
          .orderBy(desc(conversations.startedAt))
          .limit(100);
        const recent = await tx
          .select({ metrics: conversations.voiceMetrics, carrier: phoneNumbers.provider })
          .from(conversations)
          .leftJoin(phoneNumbers, eq(conversations.phoneNumberId, phoneNumbers.id))
          .where(
            and(
              eq(conversations.tenantId, access.tenantId),
              isNotNull(conversations.voiceMetrics),
              gte(conversations.startedAt, since),
            ),
          );
        const turnTotals = (c: (typeof recent)[number]) =>
          (c.metrics?.turns ?? [])
            .map((t) => t.totalMs)
            .filter((v): v is number => typeof v === "number");
        const totals = recent.flatMap(turnTotals);
        // Phone calls per carrier, to compare Twilio and Telnyx side by side.
        const byCarrier = [...new Set(recent.flatMap((c) => (c.carrier ? [c.carrier] : [])))]
          .sort()
          .map((carrier) => {
            const calls = recent.filter((c) => c.carrier === carrier);
            const values = calls.flatMap(turnTotals);
            return {
              carrier,
              calls: calls.length,
              medianMs: percentile(values, 50),
              p90Ms: percentile(values, 90),
            };
          });
        return {
          calls: rows.map((x) => callView(x.call, x, showPhone)),
          latency: {
            days: 7,
            calls: recent.length,
            turns: totals.length,
            medianMs: percentile(totals, 50),
            p90Ms: percentile(totals, 90),
            byCarrier,
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
          .select({
            call: conversations,
            e164: phoneNumbers.e164,
            carrier: phoneNumbers.provider,
            department: departments.name,
          })
          .from(conversations)
          .leftJoin(phoneNumbers, eq(conversations.phoneNumberId, phoneNumbers.id))
          .leftJoin(departments, eq(conversations.departmentId, departments.id))
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
            metadata: conversationMessages.metadata,
            createdAt: conversationMessages.createdAt,
          })
          .from(conversationMessages)
          .where(eq(conversationMessages.conversationId, found.call.id))
          .orderBy(asc(conversationMessages.id));
        // Phase 5: when the call went to a person at the VA console, and who answered.
        const handoffRows = await tx
          .select({ handoff: handoffs, name: user.name })
          .from(handoffs)
          .leftJoin(user, eq(user.id, handoffs.answeredBy))
          .where(eq(handoffs.conversationId, found.call.id))
          .orderBy(asc(handoffs.queuedAt));
        // ADR 0025: each department choice or move, in order.
        const moves = await tx
          .select({ at: departmentMoves.at, via: departmentMoves.via, name: departments.name })
          .from(departmentMoves)
          .leftJoin(departments, eq(departments.id, departmentMoves.departmentId))
          .where(eq(departmentMoves.conversationId, found.call.id))
          .orderBy(asc(departmentMoves.at));
        // ADR 0026: the follow-up the caller agreed to, if any.
        const [followUp] = await tx
          .select({
            status: followUps.status,
            sendAt: followUps.sendAt,
            sentAt: followUps.sentAt,
            channel: followUps.channel,
            booked: followUps.bookingId,
            reason: followUps.reason,
          })
          .from(followUps)
          .where(eq(followUps.conversationId, found.call.id));
        return {
          ...callView(found.call, found, showPhone),
          followUp: followUp ? { ...followUp, booked: followUp.booked !== null } : null,
          departmentMoves: moves,
          summary: found.call.summary,
          latency: found.call.voiceMetrics,
          handoffs: handoffRows.map(({ handoff, name }) => ({
            status: handoff.status,
            reason: handoff.reason,
            queuedAt: handoff.queuedAt,
            answeredAt: handoff.answeredAt,
            endedAt: handoff.endedAt,
            answeredBy: name?.split(" ")[0] ?? null,
          })),
          messages: messages.map(({ metadata, ...m }) => ({
            ...m,
            withPerson: (metadata as { withPerson?: boolean } | null)?.withPerson === true,
          })),
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
      // Recordings are personal data: every download is audited (security audit H6).
      await withTenant(deps.db, access.tenantId, (tx) =>
        recordAudit(tx, {
          tenantId: access.tenantId,
          actorType: "user",
          actorUserId: access.session.user.id,
          action: "call.recording_downloaded",
          targetType: "conversation",
          targetId: request.params.callId,
          ipAddress: request.ip ?? null,
        }),
      );
      const audio = await deps.storage.get(row.key);
      if (!audio) throw notFound();
      return reply
        .header("content-type", "audio/wav")
        .header("cache-control", "private, no-store")
        .send(Buffer.from(audio));
    },
  );
}
