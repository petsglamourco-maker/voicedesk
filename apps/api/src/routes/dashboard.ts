import { localDateString, zonedToUtc } from "@voicedesk/agent-brain";
import {
  bookings,
  conversations,
  feedback,
  handoffs,
  knowledgeGaps,
  outboundCalls,
  staffMessages,
  tenants,
  tickets,
  withTenant,
} from "@voicedesk/db";
import { and, eq, gte, lt, ne, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { notFound } from "../lib/errors";
import { requireTenantAccess } from "./guards";

/**
 * Dashboard: engagement across every touchpoint (calls in and out, website chat, WhatsApp,
 * email, forms) by day, week or month, in the business's own time zone, with the previous
 * period for comparison.
 */

export type DashboardView = "daily" | "weekly" | "monthly";
const UNIT: Record<DashboardView, "day" | "week" | "month"> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
};
const COUNT: Record<DashboardView, number> = { daily: 14, weekly: 12, monthly: 12 };

export const TOUCHPOINTS = [
  "voice",
  "outbound",
  "web_chat",
  "whatsapp",
  "email",
  "web_form",
] as const;
export type Touchpoint = (typeof TOUCHPOINTS)[number];

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(date: string, months: number): string {
  const d = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Bucket start dates (local YYYY-MM-DD), oldest first, ending with the current bucket. */
export function bucketKeys(view: DashboardView, today: string): string[] {
  const n = COUNT[view];
  if (view === "daily") return Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));
  if (view === "weekly") {
    const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    const monday = addDays(today, -dow);
    return Array.from({ length: n }, (_, i) => addDays(monday, (i - n + 1) * 7));
  }
  const first = `${today.slice(0, 7)}-01`;
  return Array.from({ length: n }, (_, i) => addMonths(first, i - n + 1));
}

function nextBucket(view: DashboardView, key: string): string {
  if (view === "daily") return addDays(key, 1);
  if (view === "weekly") return addDays(key, 7);
  return addMonths(key, 1);
}

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : null);

export function registerDashboardRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/tenants/:tenantId/dashboard",
    {
      schema: {
        tags: ["dashboard"],
        summary: "Engagement across all touchpoints, by day / week / month",
        params: z.object({ tenantId: z.string() }),
        querystring: z.object({
          view: z.enum(["daily", "weekly", "monthly"]).default("daily"),
        }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "records:read",
      );
      const tenantId = access.tenantId;
      const view = request.query.view;
      const unit = UNIT[view];
      return withTenant(deps.db, tenantId, async (tx) => {
        const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
        if (!tenant) throw notFound();
        const tz = tenant.timezone;
        const now = new Date();
        const keys = bucketKeys(view, localDateString(now, tz));
        const start = zonedToUtc(keys[0]!, "00:00", tz);
        const end = zonedToUtc(nextBucket(view, keys.at(-1)!), "00:00", tz);
        // The same length of time just before, for "vs previous period".
        const prevStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
        const index = new Map(keys.map((k, i) => [k, i]));
        const zeros = () => keys.map(() => 0);

        /** Local bucket key of a timestamp column, e.g. '2026-10-19'. */
        const bucket = (col: PgColumn | SQL) =>
          sql<string>`to_char(date_trunc(${unit}, ${col} at time zone ${tz}), 'YYYY-MM-DD')`;
        const inRange = (col: PgColumn) => and(gte(col, start), lt(col, end));
        const inPrev = (col: PgColumn) => and(gte(col, prevStart), lt(col, start));
        const count = sql<number>`count(*)::int`;

        // --- conversations per touchpoint ---
        const touchpoint = sql<string>`case when ${conversations.channel} = 'voice' and ${conversations.direction} = 'outbound' then 'outbound' else ${conversations.channel}::text end`;
        const notTest = ne(conversations.channel, "test_console");
        const convRows = await tx
          .select({ key: bucket(conversations.startedAt), touchpoint, n: count })
          .from(conversations)
          .where(
            and(eq(conversations.tenantId, tenantId), notTest, inRange(conversations.startedAt)),
          )
          .groupBy(sql`1`, sql`2`);
        const byTouchpoint = Object.fromEntries(TOUCHPOINTS.map((t) => [t, zeros()])) as Record<
          Touchpoint,
          number[]
        >;
        for (const row of convRows) {
          const i = index.get(row.key);
          const series = byTouchpoint[row.touchpoint as Touchpoint];
          if (i !== undefined && series) series[i]! += row.n;
        }
        const conversationsSeries = keys.map((_, i) =>
          TOUCHPOINTS.reduce((s, t) => s + byTouchpoint[t][i]!, 0),
        );

        const [totals] = await tx
          .select({
            current: sql<number>`count(*) filter (where ${conversations.startedAt} >= ${start})::int`,
            previous: sql<number>`count(*) filter (where ${conversations.startedAt} < ${start})::int`,
            customers: sql<number>`count(distinct ${conversations.contactId}) filter (where ${conversations.startedAt} >= ${start})::int`,
            customersPrev: sql<number>`count(distinct ${conversations.contactId}) filter (where ${conversations.startedAt} < ${start})::int`,
            withRecord: sql<number>`count(*) filter (where ${conversations.startedAt} >= ${start} and jsonb_array_length(coalesce(${conversations.state}->'records', '[]'::jsonb)) > 0)::int`,
            byPerson: sql<number>`count(*) filter (where ${conversations.startedAt} >= ${start} and (
              exists (select 1 from handoffs h where h.conversation_id = "conversations"."id" and h.answered_at is not null)
              or exists (select 1 from conversation_messages m where m.conversation_id = "conversations"."id" and m.metadata->>'human' = 'true')))::int`,
          })
          .from(conversations)
          .where(
            and(
              eq(conversations.tenantId, tenantId),
              notTest,
              gte(conversations.startedAt, prevStart),
              lt(conversations.startedAt, end),
            ),
          );

        // --- records per bucket (current) and totals (previous) ---
        async function perBucket(
          table: typeof bookings | typeof tickets | typeof staffMessages,
          col: PgColumn,
          tenantCol: PgColumn,
        ) {
          const rows = await tx
            .select({ key: bucket(col), n: count })
            .from(table)
            .where(and(eq(tenantCol, tenantId), inRange(col)))
            .groupBy(sql`1`);
          const series = zeros();
          for (const row of rows) {
            const i = index.get(row.key);
            if (i !== undefined) series[i] = row.n;
          }
          const [prev] = await tx
            .select({ n: count })
            .from(table)
            .where(and(eq(tenantCol, tenantId), inPrev(col)));
          return { series, total: series.reduce((a, b) => a + b, 0), previous: prev?.n ?? 0 };
        }
        const bookingStats = await perBucket(bookings, bookings.createdAt, bookings.tenantId);
        const ticketStats = await perBucket(tickets, tickets.createdAt, tickets.tenantId);
        const messageStats = await perBucket(
          staffMessages,
          staffMessages.createdAt,
          staffMessages.tenantId,
        );

        // --- people taking over ---
        const [handoffTotals] = await tx
          .select({
            answered: sql<number>`count(*) filter (where ${handoffs.answeredAt} is not null)::int`,
            missed: sql<number>`count(*) filter (where ${handoffs.status} = 'missed')::int`,
          })
          .from(handoffs)
          .where(and(eq(handoffs.tenantId, tenantId), inRange(handoffs.queuedAt)));

        // --- ratings ---
        const ratingRows = await tx
          .select({
            key: bucket(feedback.sentAt),
            good: sql<number>`count(*) filter (where ${feedback.kind} = 'csat' and ${feedback.score} >= 4)::int`,
            answered: sql<number>`count(*) filter (where ${feedback.kind} = 'csat' and ${feedback.score} is not null)::int`,
          })
          .from(feedback)
          .where(and(eq(feedback.tenantId, tenantId), inRange(feedback.sentAt)))
          .groupBy(sql`1`);
        const csatSeries: Array<number | null> = keys.map(() => null);
        let good = 0;
        let answered = 0;
        for (const row of ratingRows) {
          const i = index.get(row.key);
          if (i !== undefined) csatSeries[i] = pct(row.good, row.answered);
          good += row.good;
          answered += row.answered;
        }
        const [prevRatings] = await tx
          .select({
            good: sql<number>`count(*) filter (where ${feedback.kind} = 'csat' and ${feedback.score} >= 4)::int`,
            answered: sql<number>`count(*) filter (where ${feedback.kind} = 'csat' and ${feedback.score} is not null)::int`,
          })
          .from(feedback)
          .where(and(eq(feedback.tenantId, tenantId), inPrev(feedback.sentAt)));

        // --- voice response time (median of each call's median, per bucket) ---
        const latencyRows = await tx
          .select({
            key: bucket(conversations.startedAt),
            ms: sql<
              number | null
            >`percentile_cont(0.5) within group (order by (${conversations.voiceMetrics}->>'medianMs')::numeric)`,
          })
          .from(conversations)
          .where(
            and(
              eq(conversations.tenantId, tenantId),
              inRange(conversations.startedAt),
              sql`${conversations.voiceMetrics}->>'medianMs' is not null`,
            ),
          )
          .groupBy(sql`1`);
        const latencySeries: Array<number | null> = keys.map(() => null);
        for (const row of latencyRows) {
          const i = index.get(row.key);
          if (i !== undefined && row.ms !== null) latencySeries[i] = Math.round(Number(row.ms));
        }
        const [latencyAll] = await tx
          .select({
            ms: sql<
              number | null
            >`percentile_cont(0.5) within group (order by (${conversations.voiceMetrics}->>'medianMs')::numeric)`,
          })
          .from(conversations)
          .where(
            and(
              eq(conversations.tenantId, tenantId),
              inRange(conversations.startedAt),
              sql`${conversations.voiceMetrics}->>'medianMs' is not null`,
            ),
          );

        // --- what customers wanted, and how they felt ---
        const intentRows = await tx
          .select({
            intent: sql<string>`coalesce(${conversations.summary}->>'intent', 'other')`,
            n: count,
          })
          .from(conversations)
          .where(
            and(
              eq(conversations.tenantId, tenantId),
              notTest,
              inRange(conversations.startedAt),
              sql`${conversations.summary} is not null`,
            ),
          )
          .groupBy(sql`1`);
        const sentimentRows = await tx
          .select({ sentiment: sql<string>`${conversations.summary}->>'sentiment'`, n: count })
          .from(conversations)
          .where(
            and(
              eq(conversations.tenantId, tenantId),
              notTest,
              inRange(conversations.startedAt),
              sql`${conversations.summary}->>'sentiment' is not null`,
            ),
          )
          .groupBy(sql`1`);

        // --- when customers get in touch (weekday × hour, local time) ---
        const heatRows = await tx
          .select({
            dow: sql<number>`(extract(isodow from ${conversations.startedAt} at time zone ${tz}) - 1)::int`,
            hour: sql<number>`extract(hour from ${conversations.startedAt} at time zone ${tz})::int`,
            n: count,
          })
          .from(conversations)
          .where(
            and(eq(conversations.tenantId, tenantId), notTest, inRange(conversations.startedAt)),
          )
          .groupBy(sql`1`, sql`2`);
        const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
        for (const row of heatRows) heatmap[row.dow]![row.hour] = row.n;

        // --- the assistant's own calls, and questions it couldn't answer ---
        const [outbound] = await tx
          .select({
            placed: sql<number>`count(*) filter (where ${outboundCalls.attempts} > 0)::int`,
            answered: sql<number>`count(*) filter (where ${outboundCalls.status} = 'answered')::int`,
          })
          .from(outboundCalls)
          .where(and(eq(outboundCalls.tenantId, tenantId), inRange(outboundCalls.createdAt)));
        const [gaps] = await tx
          .select({ n: count })
          .from(knowledgeGaps)
          .where(and(eq(knowledgeGaps.tenantId, tenantId), inRange(knowledgeGaps.createdAt)));

        const current = totals?.current ?? 0;
        return {
          view,
          timezone: tz,
          buckets: keys,
          touchpoints: byTouchpoint,
          series: {
            conversations: conversationsSeries,
            bookings: bookingStats.series,
            tickets: ticketStats.series,
            messages: messageStats.series,
            csat: csatSeries,
            latencyMs: latencySeries,
          },
          kpis: {
            conversations: { value: current, previous: totals?.previous ?? 0 },
            customers: { value: totals?.customers ?? 0, previous: totals?.customersPrev ?? 0 },
            bookings: { value: bookingStats.total, previous: bookingStats.previous },
            tickets: { value: ticketStats.total, previous: ticketStats.previous },
            messages: { value: messageStats.total, previous: messageStats.previous },
            csat: {
              value: pct(good, answered),
              previous: pct(prevRatings?.good ?? 0, prevRatings?.answered ?? 0),
              answers: answered,
            },
            aiResolved: { value: pct(current - (totals?.byPerson ?? 0), current) },
            latencyMs: {
              value:
                latencyAll?.ms === null || latencyAll?.ms === undefined
                  ? null
                  : Math.round(Number(latencyAll.ms)),
            },
            handoffs: {
              answered: handoffTotals?.answered ?? 0,
              missed: handoffTotals?.missed ?? 0,
            },
            outbound: { placed: outbound?.placed ?? 0, answered: outbound?.answered ?? 0 },
            unanswered: gaps?.n ?? 0,
          },
          channelMix: Object.fromEntries(
            TOUCHPOINTS.map((t) => [t, byTouchpoint[t].reduce((a, b) => a + b, 0)]),
          ),
          funnel: {
            conversations: current,
            withRecord: totals?.withRecord ?? 0,
            bookings: bookingStats.total,
          },
          intents: intentRows
            .sort((a, b) => b.n - a.n)
            .map((r) => ({ intent: r.intent, count: r.n })),
          sentiment: Object.fromEntries(sentimentRows.map((r) => [r.sentiment, r.n])),
          heatmap,
        };
      });
    },
  );
}
