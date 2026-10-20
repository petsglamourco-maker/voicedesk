import {
  initialState,
  loadAgentContext,
  normalisePhone,
  scheduleCallbackFor,
} from "@voicedesk/agent-brain";
import { listAnswerers, recordAudit, setPresence } from "@voicedesk/core";
import {
  contacts,
  conversations,
  outboundCalls,
  phoneNumbers,
  tenants,
  withTenant,
} from "@voicedesk/db";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { carrierOf } from "../lib/phone-numbers";
import { requireTenantAccess } from "./guards";

/**
 * Outbound calls from the VA console (Phase 5, ADR 0018): a person rings a customer and the
 * customer sees the business's number. Costs per minute at the carrier, so it only works
 * once an outbound trunk is set up in .env.
 */

/** UK practice for unsolicited calls; a callback the customer asked for may go outside it. */
export const CALLING_HOURS = { from: 8, to: 21 } as const;

export function outboundRefusal(params: {
  now: Date;
  timezone: string;
  callback: boolean;
  doNotCall: boolean;
}): { code: string; message: string } | null {
  if (params.doNotCall) {
    return { code: "DO_NOT_CALL", message: "This contact asked not to be phoned" };
  }
  if (!params.callback) {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: params.timezone,
        hour: "2-digit",
        hourCycle: "h23",
      }).format(params.now),
    );
    if (hour < CALLING_HOURS.from || hour >= CALLING_HOURS.to) {
      return {
        code: "OUTSIDE_CALLING_HOURS",
        message: `Calls go out between ${CALLING_HOURS.from}:00 and ${CALLING_HOURS.to}:00 (the business's time), unless the customer asked for a callback`,
      };
    }
  }
  return null;
}

export function registerOutboundRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["va"];
  const params = z.object({ tenantId: z.string() });

  r.post(
    "/api/tenants/:tenantId/outbound-calls",
    {
      schema: {
        tags,
        summary: "Ring a customer from the business's number (VA console softphone)",
        params,
        body: z.object({
          to: z.string().trim().min(5).max(30),
          contactId: z.string().uuid().optional(),
          /** The customer asked to be called back (e.g. from a message or ticket). */
          callback: z.boolean().default(false),
          phoneNumberId: z.string().uuid().optional(),
        }),
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "calls:read",
      );
      const tenantId = access.tenantId;
      const userId = access.session.user.id;
      const answerers = await listAnswerers(deps.db, tenantId);
      if (!answerers.some((a) => a.userId === userId)) {
        throw new HttpError(403, "NOT_AN_ANSWERER", "You don't take calls for this business");
      }
      if (!deps.sip || !deps.voice) {
        throw new HttpError(
          503,
          "VOICE_NOT_CONFIGURED",
          "LiveKit is not configured on this server",
        );
      }
      const found = await withTenant(deps.db, tenantId, async (tx) => {
        const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
        const numbers = await tx
          .select()
          .from(phoneNumbers)
          .where(
            and(
              eq(phoneNumbers.tenantId, tenantId),
              eq(phoneNumbers.status, "active"),
              isNotNull(phoneNumbers.livekitTrunkId),
            ),
          )
          .orderBy(asc(phoneNumbers.createdAt));
        return { tenant, numbers };
      });
      if (!found.tenant) throw notFound();
      const number = request.body.phoneNumberId
        ? found.numbers.find((n) => n.id === request.body.phoneNumberId)
        : found.numbers[0];
      if (!number) {
        throw new HttpError(409, "NO_NUMBER", "This business has no phone number to call from");
      }
      const carrier = carrierOf(number);
      if (!deps.sip.canDial(carrier)) {
        throw new HttpError(
          409,
          "OUTBOUND_NOT_CONFIGURED",
          `Outbound calls through ${carrier === "telnyx" ? "Telnyx" : "Twilio"} aren't set up yet`,
        );
      }
      const to = normalisePhone(request.body.to, found.tenant.countryCode);
      if (!to) throw new HttpError(400, "INVALID_PHONE", "That phone number isn't valid");

      const contact = await withTenant(deps.db, tenantId, async (tx) => {
        const [row] = await tx
          .select()
          .from(contacts)
          .where(
            and(
              eq(contacts.tenantId, tenantId),
              request.body.contactId
                ? eq(contacts.id, request.body.contactId)
                : eq(contacts.phoneE164, to),
            ),
          );
        return row ?? null;
      });
      const refusal = outboundRefusal({
        now: new Date(),
        timezone: found.tenant.timezone,
        callback: request.body.callback,
        doNotCall: contact?.doNotCall === true,
      });
      if (refusal) throw new HttpError(409, refusal.code, refusal.message);

      const ctx = await loadAgentContext(deps.db, tenantId, "voice");
      const [conversation] = await withTenant(deps.db, tenantId, (tx) =>
        tx
          .insert(conversations)
          .values({
            tenantId,
            channel: "voice",
            style: "voice",
            personaId: ctx.persona.id,
            language: ctx.defaultLanguage,
            state: initialState(ctx.defaultLanguage, to) as unknown as Record<string, unknown>,
            contactId: contact?.id ?? null,
            createdBy: userId,
            phoneNumberId: number.id,
            direction: "outbound",
          })
          .returning(),
      );
      const roomName = `out-${conversation!.id}`;
      const firstName = access.session.user.name.split(" ")[0] || "Team";
      const join = await deps.voice.joinCall({
        roomName,
        identity: `va-${userId}`,
        displayName: firstName,
      });
      try {
        await deps.sip.dial({
          carrier,
          from: number.e164,
          to,
          roomName,
          participantIdentity: "customer",
        });
      } catch (error) {
        await withTenant(deps.db, tenantId, (tx) =>
          tx
            .update(conversations)
            .set({ status: "ended", endedAt: new Date() })
            .where(eq(conversations.id, conversation!.id)),
        );
        request.log.error({ err: error }, "outbound call failed");
        throw new HttpError(502, "DIAL_FAILED", "The call couldn't be placed");
      }
      await setPresence(deps.db, userId, "busy");
      await withTenant(deps.db, tenantId, (tx) =>
        recordAudit(tx, {
          tenantId,
          actorType: "user",
          actorUserId: userId,
          action: "call.outbound",
          targetType: "conversation",
          targetId: conversation!.id,
          metadata: { callback: request.body.callback },
        }),
      );
      return {
        ...join,
        conversationId: conversation!.id,
        callee: contact?.fullName ?? to,
      };
    },
  );

  // ---- Calls the assistant places (Phase 6, ADR 0019) ----

  r.post(
    "/api/tenants/:tenantId/ai-calls",
    {
      schema: {
        tags,
        summary: "Ask the assistant to call a customer back about a ticket or message",
        params,
        body: z.object({
          sourceType: z.enum(["ticket", "message"]),
          sourceId: z.string().uuid(),
          /** When to call (the calling-hours rules still apply); default as soon as allowed. */
          at: z.coerce.date().optional(),
        }),
      },
    },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "records:write",
      );
      const row = await scheduleCallbackFor(
        deps.db,
        access.tenantId,
        { type: request.body.sourceType, id: request.body.sourceId },
        { force: true, notBefore: request.body.at, createdBy: access.session.user.id },
      );
      if (!row) {
        throw new HttpError(
          409,
          "CANNOT_SCHEDULE",
          "There's no phone number on this record, or a call is already planned",
        );
      }
      await withTenant(deps.db, access.tenantId, (tx) =>
        recordAudit(tx, {
          tenantId: access.tenantId,
          actorType: "user",
          actorUserId: access.session.user.id,
          action: "ai_call.scheduled",
          targetType: request.body.sourceType,
          targetId: request.body.sourceId,
        }),
      );
      return reply.code(201).send({ id: row.id, notBefore: row.notBefore, status: row.status });
    },
  );

  r.get(
    "/api/tenants/:tenantId/ai-calls",
    { schema: { tags, summary: "Calls the assistant will make, and recent results", params } },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "calls:read",
      );
      const rows = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .select({ call: outboundCalls, contactName: contacts.fullName })
          .from(outboundCalls)
          .leftJoin(contacts, eq(contacts.id, outboundCalls.contactId))
          .where(eq(outboundCalls.tenantId, access.tenantId))
          .orderBy(desc(outboundCalls.createdAt))
          .limit(50),
      );
      return {
        calls: rows.map(({ call, contactName }) => ({
          id: call.id,
          purpose: call.purpose,
          status: call.status,
          outcome: call.outcome,
          reason: call.reason,
          name: contactName,
          phone: call.phone,
          notBefore: call.notBefore,
          attempts: call.attempts,
          conversationId: call.conversationId,
        })),
      };
    },
  );

  r.delete(
    "/api/tenants/:tenantId/ai-calls/:id",
    {
      schema: {
        tags,
        summary: "Cancel a call the assistant hasn't made yet",
        params: params.extend({ id: z.string().uuid() }),
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
          .update(outboundCalls)
          .set({ status: "cancelled", outcome: "cancelled by staff", updatedAt: new Date() })
          .where(
            and(
              eq(outboundCalls.id, request.params.id),
              eq(outboundCalls.tenantId, access.tenantId),
              inArray(outboundCalls.status, ["scheduled"]),
            ),
          )
          .returning(),
      );
      if (!row) throw notFound();
      return { status: row.status };
    },
  );

  r.post(
    "/api/tenants/:tenantId/outbound-calls/:conversationId/end",
    {
      schema: {
        tags,
        summary: "Hang up an outbound call (also used when the customer hung up)",
        params: params.extend({ conversationId: z.string().uuid() }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "calls:read",
      );
      const [row] = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .update(conversations)
          .set({ status: "ended", endedAt: new Date() })
          .where(
            and(
              eq(conversations.id, request.params.conversationId),
              eq(conversations.tenantId, access.tenantId),
              eq(conversations.direction, "outbound"),
              eq(conversations.createdBy, access.session.user.id),
              eq(conversations.status, "active"),
            ),
          )
          .returning(),
      );
      if (row) await deps.voice?.endCall(`out-${row.id}`);
      await setPresence(deps.db, access.session.user.id, "available");
      return { ended: true };
    },
  );
}
