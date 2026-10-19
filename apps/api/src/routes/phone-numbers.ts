import { phoneNumbers, tenants, withPlatformAccess, withTenant } from "@voicedesk/db";
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { carrierOf, registerPhoneNumber } from "../lib/phone-numbers";
import { PHONE_CARRIERS, type SipGateway } from "../lib/sip";
import { requireTenantAccess } from "./guards";
import { requirePlatformOwner } from "./platform";

const e164 = z
  .string()
  .transform((s) => s.replace(/[\s()-]/g, ""))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, "Use international format, e.g. +442071234567"));

const numberView = z.object({
  id: z.string(),
  tenantId: z.string(),
  e164: z.string(),
  label: z.string().nullable(),
  carrier: z.enum(PHONE_CARRIERS),
  status: z.string(),
  routed: z.boolean(),
  createdAt: z.date(),
});

type NumberRow = typeof phoneNumbers.$inferSelect;
const toView = (row: NumberRow) => ({
  id: row.id,
  tenantId: row.tenantId,
  e164: row.e164,
  label: row.label,
  carrier: carrierOf(row),
  status: row.status,
  routed: Boolean(row.livekitTrunkId && row.livekitDispatchRuleId),
  createdAt: row.createdAt,
});

function requireSip(deps: AppDeps): SipGateway {
  if (!deps.sip) {
    throw new HttpError(503, "SIP_NOT_CONFIGURED", "LiveKit is not configured on this server");
  }
  return deps.sip;
}

export function registerPhoneNumberRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["phone numbers"];
  const access = (actorUserId: string, reason: string) => ({ actorUserId, reason });

  r.get(
    "/api/platform/phone-numbers",
    { schema: { tags, summary: "All phone numbers and the businesses they can be assigned to" } },
    async (request) => {
      const session = await requirePlatformOwner(deps, request);
      return withPlatformAccess(
        deps.db,
        access(session.user.id, "list phone numbers"),
        async (tx) => ({
          numbers: (await tx.select().from(phoneNumbers).orderBy(asc(phoneNumbers.e164))).map(
            toView,
          ),
          tenants: await tx
            .select({ id: tenants.id, name: tenants.name })
            .from(tenants)
            .orderBy(asc(tenants.name)),
          sipConfigured: deps.sip != null,
        }),
      );
    },
  );

  r.post(
    "/api/platform/phone-numbers",
    {
      schema: {
        tags,
        summary: "Register a number bought in Twilio or Telnyx and route its calls to a business",
        body: z.object({
          e164,
          tenantId: z.string().uuid(),
          label: z.string().trim().max(60).optional(),
          carrier: z.enum(PHONE_CARRIERS).default("twilio"),
        }),
        response: { 201: numberView },
      },
    },
    async (request, reply) => {
      const session = await requirePlatformOwner(deps, request);
      const sip = requireSip(deps);
      try {
        const row = await registerPhoneNumber({ db: deps.db, sip }, session.user.id, request.body);
        return reply.status(201).send(toView(row));
      } catch (error) {
        if (error instanceof HttpError && error.code === "SIP_ROUTE_FAILED") {
          request.log.error({ err: error.cause }, "creating SIP route failed");
        }
        throw error;
      }
    },
  );

  r.patch(
    "/api/platform/phone-numbers/:id",
    {
      schema: {
        tags,
        summary: "Reassign a number to another business, relabel it, or switch it off",
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          tenantId: z.string().uuid().optional(),
          label: z.string().trim().max(60).nullable().optional(),
          status: z.enum(["active", "disabled"]).optional(),
        }),
        response: { 200: numberView },
      },
    },
    async (request) => {
      const session = await requirePlatformOwner(deps, request);
      const actor = access(session.user.id, "update phone number");
      const [current] = await withPlatformAccess(deps.db, actor, (tx) =>
        tx.select().from(phoneNumbers).where(eq(phoneNumbers.id, request.params.id)),
      );
      if (!current) throw notFound();
      const tenantId = request.body.tenantId ?? current.tenantId;
      const status = request.body.status ?? current.status;
      let route: { livekitTrunkId: string | null; livekitDispatchRuleId: string | null } = {
        livekitTrunkId: current.livekitTrunkId,
        livekitDispatchRuleId: current.livekitDispatchRuleId,
      };
      // The business is baked into the dispatch metadata, and a disabled number must stop
      // ringing, so either change rebuilds (or removes) the LiveKit route.
      if (tenantId !== current.tenantId || status !== current.status) {
        const sip = requireSip(deps);
        await sip.deleteRoute({
          trunkId: current.livekitTrunkId ?? undefined,
          dispatchRuleId: current.livekitDispatchRuleId ?? undefined,
        });
        route = { livekitTrunkId: null, livekitDispatchRuleId: null };
        if (status === "active") {
          const created = await sip.createRoute({
            e164: current.e164,
            carrier: carrierOf(current),
            metadata: { tenantId, phoneNumberId: current.id },
          });
          route = {
            livekitTrunkId: created.trunkId,
            livekitDispatchRuleId: created.dispatchRuleId,
          };
        }
      }
      const [row] = await withPlatformAccess(deps.db, actor, (tx) =>
        tx
          .update(phoneNumbers)
          .set({
            tenantId,
            status,
            label: request.body.label === undefined ? current.label : request.body.label,
            ...route,
            updatedAt: new Date(),
          })
          .where(eq(phoneNumbers.id, current.id))
          .returning(),
      );
      return toView(row!);
    },
  );

  r.delete(
    "/api/platform/phone-numbers/:id",
    {
      schema: {
        tags,
        summary: "Stop routing a number and remove it (release it at the carrier separately)",
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (request, reply) => {
      const session = await requirePlatformOwner(deps, request);
      const actor = access(session.user.id, "remove phone number");
      const [current] = await withPlatformAccess(deps.db, actor, (tx) =>
        tx.select().from(phoneNumbers).where(eq(phoneNumbers.id, request.params.id)),
      );
      if (!current) throw notFound();
      if (current.livekitTrunkId || current.livekitDispatchRuleId) {
        await requireSip(deps).deleteRoute({
          trunkId: current.livekitTrunkId ?? undefined,
          dispatchRuleId: current.livekitDispatchRuleId ?? undefined,
        });
      }
      await withPlatformAccess(deps.db, actor, (tx) =>
        tx.delete(phoneNumbers).where(eq(phoneNumbers.id, current.id)),
      );
      return reply.status(204).send();
    },
  );

  r.get(
    "/api/tenants/:tenantId/phone-numbers",
    {
      schema: {
        tags,
        summary: "This business's phone numbers",
        params: z.object({ tenantId: z.string() }),
        response: { 200: z.object({ numbers: z.array(numberView) }) },
      },
    },
    async (request) => {
      const tenant = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "tenant:read",
      );
      const rows = await withTenant(deps.db, tenant.tenantId, (tx) =>
        tx
          .select()
          .from(phoneNumbers)
          .where(eq(phoneNumbers.tenantId, tenant.tenantId))
          .orderBy(asc(phoneNumbers.e164)),
      );
      return { numbers: rows.map(toView) };
    },
  );
}
