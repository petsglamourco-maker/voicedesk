import {
  createDbAgentServices,
  LANGUAGES,
  checkDestination,
  destinationMessage,
  getPlatformSpendSettings,
  normalisePhone,
  PERSONA_IDS,
  PERSONAS,
} from "@voicedesk/agent-brain";
import { recordAudit, requireFeature } from "@voicedesk/core";
import {
  agentSettings,
  bookings,
  contacts,
  knowledgeGaps,
  staffMessages,
  tenants,
  tickets,
  withTenant,
} from "@voicedesk/db";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { requireTenantAccess, type TenantAccess } from "./guards";

const params = z.object({ tenantId: z.string() });

const settingsSchema = z.object({
  personaId: z.enum(PERSONA_IDS as [string, ...string[]]),
  personaNames: z.record(z.string(), z.string().trim().min(1).max(40)),
  enabledLanguages: z.array(z.enum(LANGUAGES)).min(1),
  adminLanguage: z.enum(LANGUAGES),
  recordCalls: z.boolean().default(false),
  /** ElevenLabs voice ids per persona; empty string = default voice. */
  voiceIds: z
    .record(
      z.string(),
      z
        .string()
        .trim()
        .max(64)
        .regex(/^[A-Za-z0-9]*$/),
    )
    .default({}),
  /** Hours before a booking to remind the customer; 0 = no reminders. */
  reminderHours: z.number().int().min(0).max(168).default(24),
  customerConfirmations: z.boolean().default(true),
  /** Mobile for urgent alerts by SMS (any format; stored as E.164). */
  alertPhone: z.string().trim().max(40).nullable().default(null),
  /** Phone calls: put callers through to this number when they ask for a person. */
  transferPhone: z.string().trim().max(40).nullable().default(null),
  transferHours: z.enum(["open", "always"]).default("open"),
  /** Urgent situations only, outside the transfer hours. */
  onCallPhone: z.string().trim().max(40).nullable().default(null),
  urgentSituations: z.string().trim().max(500).nullable().default(null),
  handoffRoute: z
    .enum(["people_then_phone", "people_only", "phone_only"])
    .default("people_then_phone"),
  ringSeconds: z.number().int().min(10).max(120).default(30),
  /** ADR 0025: "backup" = the main line forwards here when nobody answers. */
  callEntry: z.enum(["direct", "backup"]).default("direct"),
  /** ADR 0025: ring the people who answer calls before the assistant helps. */
  ringFirst: z.boolean().default(false),
  feedbackEnabled: z.boolean().default(true),
  feedbackAfterCalls: z.boolean().default(false),
  npsEvery: z.number().int().min(0).max(50).default(0),
  dailyBrief: z.boolean().default(true),
  aiCallbacks: z.boolean().default(false),
  confirmationCalls: z.boolean().default(false),
  outboundDailyCap: z.number().int().min(1).max(500).default(20),
});

const settingsResponse = z.object({
  personaId: z.string(),
  personaNames: z.record(z.string(), z.string()),
  enabledLanguages: z.array(z.string()),
  adminLanguage: z.string(),
  recordCalls: z.boolean(),
  voiceIds: z.record(z.string(), z.string()),
  reminderHours: z.number(),
  customerConfirmations: z.boolean(),
  alertPhone: z.string().nullable(),
  transferPhone: z.string().nullable(),
  transferHours: z.string(),
  onCallPhone: z.string().nullable(),
  urgentSituations: z.string().nullable(),
  handoffRoute: z.string(),
  ringSeconds: z.number(),
  callEntry: z.string(),
  ringFirst: z.boolean(),
  feedbackEnabled: z.boolean(),
  feedbackAfterCalls: z.boolean(),
  npsEvery: z.number(),
  dailyBrief: z.boolean(),
  aiCallbacks: z.boolean(),
  confirmationCalls: z.boolean(),
  outboundDailyCap: z.number(),
});

const DEFAULTS = {
  personaId: "amelia",
  personaNames: {} as Record<string, string>,
  enabledLanguages: [...LANGUAGES] as string[],
  adminLanguage: "en",
  recordCalls: false,
  voiceIds: {} as Record<string, string>,
  reminderHours: 24,
  customerConfirmations: true,
  alertPhone: null as string | null,
  transferPhone: null as string | null,
  transferHours: "open",
  onCallPhone: null as string | null,
  urgentSituations: null as string | null,
  handoffRoute: "people_then_phone",
  ringSeconds: 30,
  callEntry: "direct",
  ringFirst: false,
  feedbackEnabled: true,
  feedbackAfterCalls: false,
  npsEvery: 0,
  dailyBrief: true,
  aiCallbacks: false,
  confirmationCalls: false,
  outboundDailyCap: 20,
};

export function registerAgentRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/tenants/:tenantId/agent",
    {
      schema: {
        tags: ["agent"],
        summary: "Agent settings and the available personas",
        params,
        response: {
          200: z.object({
            settings: settingsResponse,
            personas: z.array(
              z.object({
                id: z.string(),
                defaultName: z.string(),
                gender: z.string(),
                style: z.string(),
                bestFor: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:test",
      );
      const [row] = await withTenant(deps.db, access.tenantId, (tx) =>
        tx.select().from(agentSettings).where(eq(agentSettings.tenantId, access.tenantId)),
      );
      return {
        settings: row
          ? {
              personaId: row.personaId,
              personaNames: row.personaNames,
              enabledLanguages: row.enabledLanguages,
              adminLanguage: row.adminLanguage,
              recordCalls: row.recordCalls,
              voiceIds: row.voiceIds,
              reminderHours: row.reminderHours,
              customerConfirmations: row.customerConfirmations,
              alertPhone: row.alertPhone,
              transferPhone: row.transferPhone,
              transferHours: row.transferHours,
              onCallPhone: row.onCallPhone,
              urgentSituations: row.urgentSituations,
              handoffRoute: row.handoffRoute,
              ringSeconds: row.ringSeconds,
              callEntry: row.callEntry,
              ringFirst: row.ringFirst,
              feedbackEnabled: row.feedbackEnabled,
              feedbackAfterCalls: row.feedbackAfterCalls,
              npsEvery: row.npsEvery,
              dailyBrief: row.dailyBrief,
              aiCallbacks: row.aiCallbacks,
              confirmationCalls: row.confirmationCalls,
              outboundDailyCap: row.outboundDailyCap,
            }
          : DEFAULTS,
        personas: Object.values(PERSONAS),
      };
    },
  );

  r.put(
    "/api/tenants/:tenantId/agent",
    { schema: { tags: ["agent"], params, body: settingsSchema } },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:configure",
      );
      const [tenant] = await withTenant(deps.db, access.tenantId, (tx) =>
        tx.select({ c: tenants.countryCode }).from(tenants).where(eq(tenants.id, access.tenantId)),
      );
      // Ringing the team first uses the VA console and phone app (a plan feature).
      if (request.body.ringFirst) await requireFeature(deps.db, access.tenantId, "va_console");
      if (request.body.aiCallbacks || request.body.confirmationCalls) {
        await requireFeature(deps.db, access.tenantId, "ai_calls");
      }
      const { allowedCountries } = await getPlatformSpendSettings(deps.db);
      const phone = (value: string | null, label: string) => {
        if (!value) return null;
        const e164 = normalisePhone(value, tenant?.c ?? "GB");
        if (!e164) throw new HttpError(400, "INVALID_PHONE", `The ${label} number isn't valid`);
        // Calls are transferred and texts sent to these numbers: no premium or foreign
        // destinations (security audit H3).
        const destination = checkDestination(e164, allowedCountries);
        if (!destination.ok) {
          throw new HttpError(
            400,
            "PHONE_NOT_ALLOWED",
            `The ${label} number can't be used: ${destinationMessage(destination.reason)}`,
          );
        }
        return e164;
      };
      const settings = {
        ...request.body,
        alertPhone: phone(request.body.alertPhone, "alert"),
        transferPhone: phone(request.body.transferPhone, "transfer"),
        onCallPhone: phone(request.body.onCallPhone, "on-call"),
        urgentSituations: request.body.urgentSituations || null,
      };
      const values = { ...settings, tenantId: access.tenantId };
      await withTenant(deps.db, access.tenantId, async (tx) => {
        await tx
          .insert(agentSettings)
          .values(values)
          .onConflictDoUpdate({ target: agentSettings.tenantId, set: settings });
        await recordAudit(tx, {
          tenantId: access.tenantId,
          actorType: "user",
          actorUserId: access.session.user.id,
          action: "agent.settings_updated",
          metadata: { personaId: request.body.personaId, recordCalls: request.body.recordCalls },
        });
      });
      return reply.status(204).send();
    },
  );

  r.get(
    "/api/tenants/:tenantId/records",
    {
      schema: {
        tags: ["records"],
        summary: "Recent tickets, messages and bookings created by the agent",
        params,
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "records:read",
      );
      return withTenant(deps.db, access.tenantId, async (tx) => ({
        tickets: await tx
          .select()
          .from(tickets)
          .where(eq(tickets.tenantId, access.tenantId))
          .orderBy(desc(tickets.createdAt))
          .limit(50),
        messages: await tx
          .select()
          .from(staffMessages)
          .where(eq(staffMessages.tenantId, access.tenantId))
          .orderBy(desc(staffMessages.createdAt))
          .limit(50),
        bookings: await tx
          .select()
          .from(bookings)
          .where(eq(bookings.tenantId, access.tenantId))
          .orderBy(desc(bookings.startsAt))
          .limit(50),
        signups: await tx
          .select({
            id: contacts.id,
            reference: contacts.reference,
            fullName: contacts.fullName,
            phone: contacts.phoneE164,
            email: contacts.email,
            interest: contacts.interest,
            marketingConsent: contacts.marketingConsent,
            createdAt: contacts.createdAt,
          })
          .from(contacts)
          .where(and(eq(contacts.tenantId, access.tenantId), eq(contacts.source, "assistant")))
          .orderBy(desc(contacts.updatedAt))
          .limit(50),
        knowledgeGaps: await tx
          .select()
          .from(knowledgeGaps)
          .where(and(eq(knowledgeGaps.tenantId, access.tenantId), eq(knowledgeGaps.status, "open")))
          .orderBy(desc(knowledgeGaps.createdAt))
          .limit(100),
      }));
    },
  );

  r.post(
    "/api/tenants/:tenantId/knowledge-gaps/:gapId/resolve",
    {
      schema: {
        tags: ["records"],
        summary: "Mark an unanswered question as dealt with (e.g. after adding an FAQ)",
        params: params.extend({ gapId: z.string().uuid() }),
      },
    },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "knowledge:write",
      );
      const updated = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .update(knowledgeGaps)
          .set({ status: "resolved", resolvedAt: new Date() })
          .where(
            and(
              eq(knowledgeGaps.id, request.params.gapId),
              eq(knowledgeGaps.tenantId, access.tenantId),
            ),
          )
          .returning({ id: knowledgeGaps.id }),
      );
      if (updated.length === 0) throw notFound();
      return reply.status(204).send();
    },
  );

  r.patch(
    "/api/tenants/:tenantId/tickets/:ticketId",
    {
      schema: {
        tags: ["records"],
        summary: "Move a ticket along (open → in progress → resolved / closed)",
        params: params.extend({ ticketId: z.string().uuid() }),
        body: z.object({ status: z.enum(["open", "in_progress", "resolved", "closed"]) }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "records:write",
      );
      const [row] = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .update(tickets)
          .set({ status: request.body.status, updatedAt: new Date() })
          .where(
            and(eq(tickets.id, request.params.ticketId), eq(tickets.tenantId, access.tenantId)),
          )
          .returning({ id: tickets.id, status: tickets.status }),
      );
      if (!row) throw notFound();
      return row;
    },
  );

  r.patch(
    "/api/tenants/:tenantId/messages/:messageId",
    {
      schema: {
        tags: ["records"],
        summary: "Mark a message as dealt with (or new again)",
        params: params.extend({ messageId: z.string().uuid() }),
        body: z.object({ status: z.enum(["new", "done"]) }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "records:write",
      );
      const [row] = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .update(staffMessages)
          .set({ status: request.body.status })
          .where(
            and(
              eq(staffMessages.id, request.params.messageId),
              eq(staffMessages.tenantId, access.tenantId),
            ),
          )
          .returning({ id: staffMessages.id, status: staffMessages.status }),
      );
      if (!row) throw notFound();
      return row;
    },
  );

  r.post(
    "/api/tenants/:tenantId/bookings/:bookingId/cancel",
    {
      schema: {
        tags: ["records"],
        summary: "Cancel a booking (removes it from the calendar and tells the customer)",
        params: params.extend({ bookingId: z.string().uuid() }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "records:write",
      );
      return cancelBookingAsStaff(deps, access, request.params.bookingId, request.log);
    },
  );
}

/**
 * Cancels a booking on behalf of a staff member: same path as the assistant cancelling
 * (calendar event removed, customer told), audited. Used by Records and approved
 * "Ask VoiceDesk" actions.
 */
export async function cancelBookingAsStaff(
  deps: AppDeps,
  access: TenantAccess,
  bookingId: string,
  log: { warn: (obj: object, msg: string) => void },
): Promise<{ id: string; status: "cancelled" }> {
  const [booking] = await withTenant(deps.db, access.tenantId, (tx) =>
    tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, access.tenantId))),
  );
  if (!booking) throw notFound();
  if (booking.status !== "confirmed") {
    throw new HttpError(409, "NOT_CONFIRMED", "This booking is already cancelled");
  }
  const [tenant] = await withTenant(deps.db, access.tenantId, (tx) =>
    tx.select().from(tenants).where(eq(tenants.id, access.tenantId)),
  );
  // Same path as the assistant cancelling: calendar event removed, customer told.
  const services = createDbAgentServices(
    {
      db: deps.db,
      embeddings: await deps.embeddings(),
      calendars: {
        box: deps.secrets.box,
        factory: deps.calendars?.factory ?? null,
        log: (msg, data) => log.warn(data, msg),
      },
      notify: (event) => deps.jobs.notify({ ...event, tenantId: access.tenantId }),
    },
    {
      tenantId: access.tenantId,
      // Not used when cancelling; bookings made outside a conversation have none.
      conversationId: booking.conversationId ?? "",
      businessName: tenant?.name ?? "",
      timezone: tenant?.timezone,
    },
  );
  await services.cancelBooking(booking.id);
  await withTenant(deps.db, access.tenantId, (tx) =>
    recordAudit(tx, {
      tenantId: access.tenantId,
      actorType: "user",
      actorUserId: access.session.user.id,
      action: "booking.cancelled",
      metadata: { bookingId: booking.id },
    }),
  );
  return { id: booking.id, status: "cancelled" };
}
