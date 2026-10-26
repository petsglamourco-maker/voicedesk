import { followUpCounts, localDateString, zonedToUtc } from "@voicedesk/agent-brain";
import {
  bookings,
  channelThreads,
  conversations,
  gapAnswers,
  handoffs,
  outboundCalls,
  staffMessages,
  tenants,
  withTenant,
} from "@voicedesk/db";
import { and, asc, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { notFound } from "../lib/errors";
import { requireTenantAccess } from "./guards";

/**
 * Today (ADR 0024): one screen for the day on a phone. Today's bookings, chats waiting for
 * a person, calls nobody answered, callbacks still to make and messages to return, in the
 * business's own time zone. Lists are short (the full pages have the rest).
 */

const LIMIT = 5;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

const todayView = z.object({
  date: z.string(),
  timezone: z.string(),
  bookings: z.array(
    z.object({
      id: z.string(),
      startsAt: z.string(),
      endsAt: z.string().nullable(),
      service: z.string().nullable(),
      customerName: z.string().nullable(),
      status: z.string(),
    }),
  ),
  waitingChats: z.object({
    count: z.number(),
    items: z.array(
      z.object({
        id: z.string(),
        channel: z.string(),
        displayName: z.string().nullable(),
        lastMessageAt: z.string(),
      }),
    ),
  }),
  missedCalls: z.object({
    count: z.number(),
    items: z.array(z.object({ conversationId: z.string(), at: z.string(), urgent: z.boolean() })),
  }),
  callbacks: z.object({ count: z.number() }),
  /** ADR 0025: calls the team missed that the assistant took today. */
  missedByTeam: z.object({ count: z.number() }),
  /** ADR 0026: follow-ups this month. */
  followUps: z.object({ sent: z.number(), booked: z.number(), scheduled: z.number() }),
  /** ADR 0026: grouped questions waiting for an approved answer. */
  questionsToAnswer: z.object({ count: z.number() }),
  messages: z.object({
    count: z.number(),
    items: z.array(
      z.object({
        id: z.string(),
        callerName: z.string().nullable(),
        reason: z.string(),
        urgency: z.string(),
        createdAt: z.string(),
      }),
    ),
  }),
});

export function registerTodayRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/tenants/:tenantId/today",
    {
      schema: {
        tags: ["dashboard"],
        summary: "Today at a glance: bookings, waiting chats, missed calls, messages",
        params: z.object({ tenantId: z.string() }),
        response: { 200: todayView },
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "inbox:read",
      );
      const tenantId = access.tenantId;
      return withTenant(deps.db, tenantId, async (tx) => {
        const [tenant] = await tx
          .select({ timezone: tenants.timezone })
          .from(tenants)
          .where(eq(tenants.id, tenantId));
        if (!tenant) throw notFound();
        const tz = tenant.timezone;
        const date = localDateString(new Date(), tz);
        const start = zonedToUtc(date, "00:00", tz);
        const end = new Date(start.getTime() + 36 * 3_600_000);
        const tomorrow = zonedToUtc(localDateString(end, tz), "00:00", tz);
        const count = sql<number>`count(*)::int`;

        const dayBookings = await tx
          .select()
          .from(bookings)
          .where(
            and(
              gte(bookings.startsAt, start),
              lt(bookings.startsAt, tomorrow),
              ne(bookings.status, "cancelled"),
            ),
          )
          .orderBy(asc(bookings.startsAt))
          .limit(20);

        const waitingWhere = eq(channelThreads.needsHuman, true);
        const [waiting] = await tx.select({ n: count }).from(channelThreads).where(waitingWhere);
        const waitingItems = await tx
          .select()
          .from(channelThreads)
          .where(waitingWhere)
          .orderBy(asc(channelThreads.lastMessageAt))
          .limit(LIMIT);

        const missedWhere = and(eq(handoffs.status, "missed"), gte(handoffs.queuedAt, start));
        const [missed] = await tx.select({ n: count }).from(handoffs).where(missedWhere);
        const missedItems = await tx
          .select()
          .from(handoffs)
          .where(missedWhere)
          .orderBy(desc(handoffs.queuedAt))
          .limit(LIMIT);

        const [callbacks] = await tx
          .select({ n: count })
          .from(outboundCalls)
          .where(and(eq(outboundCalls.purpose, "callback"), eq(outboundCalls.status, "scheduled")));

        const [missedByTeam] = await tx
          .select({ n: count })
          .from(conversations)
          .where(
            and(
              eq(conversations.channel, "voice"),
              ne(conversations.entry, "direct"),
              gte(conversations.startedAt, start),
            ),
          );

        const [questions] = await tx
          .select({ n: count })
          .from(gapAnswers)
          .where(eq(gapAnswers.status, "pending"));

        const messagesWhere = eq(staffMessages.status, "new");
        const [messages] = await tx.select({ n: count }).from(staffMessages).where(messagesWhere);
        const messageItems = await tx
          .select()
          .from(staffMessages)
          .where(messagesWhere)
          .orderBy(desc(staffMessages.createdAt))
          .limit(LIMIT);

        return {
          date,
          timezone: tz,
          bookings: dayBookings.map((b) => ({
            id: b.id,
            startsAt: b.startsAt.toISOString(),
            endsAt: iso(b.endsAt),
            service: b.service,
            customerName: b.customerName,
            status: b.status,
          })),
          waitingChats: {
            count: waiting?.n ?? 0,
            items: waitingItems.map((t) => ({
              id: t.id,
              channel: t.channel,
              displayName: t.displayName,
              lastMessageAt: t.lastMessageAt.toISOString(),
            })),
          },
          missedCalls: {
            count: missed?.n ?? 0,
            items: missedItems.map((h) => ({
              conversationId: h.conversationId,
              at: h.queuedAt.toISOString(),
              urgent: h.urgent,
            })),
          },
          callbacks: { count: callbacks?.n ?? 0 },
          missedByTeam: { count: missedByTeam?.n ?? 0 },
          questionsToAnswer: { count: questions?.n ?? 0 },
          followUps: await followUpCounts(
            deps.db,
            tenantId,
            zonedToUtc(`${date.slice(0, 7)}-01`, "00:00", tz),
          ),
          messages: {
            count: messages?.n ?? 0,
            items: messageItems.map((m) => ({
              id: m.id,
              callerName: m.callerName,
              reason: m.reason.length > 140 ? `${m.reason.slice(0, 139)}…` : m.reason,
              urgency: m.urgency,
              createdAt: m.createdAt.toISOString(),
            })),
          },
        };
      });
    },
  );
}
