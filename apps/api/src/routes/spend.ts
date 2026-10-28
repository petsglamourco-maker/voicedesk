import {
  allowanceFor,
  getPlatformSpendSettings,
  SPEND_CATEGORIES,
  spendOverview,
  spendStatus,
} from "@voicedesk/agent-brain";
import { SUPPORTED_COUNTRY_CODES } from "@voicedesk/compliance";
import { can, recordAudit } from "@voicedesk/core";
import {
  agentSettings,
  platformSettings,
  tenants,
  withPlatformAccess,
  withTenant,
  type PlatformSpendSettings,
} from "@voicedesk/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { requireTenantAccess } from "./guards";
import { requirePlatformOwner } from "./platform";

/**
 * Monthly spending limits (security batch 4, ADR 0022). Businesses see this month's spend
 * and set their own caps within their allowance; the platform owner sets the allowance,
 * the cost estimates, the pause switches and can suspend a business.
 */

const pence = z.number().int().min(0).max(10_000_000);
const caps = z.object({ ai: pence, sms: pence, calls: pence });
const category = z.object({
  spent: z.number(),
  cap: z.number(),
  state: z.enum(["ok", "warning", "reached"]),
});
const statusResponse = z.object({
  month: z.string(),
  categories: z.object({ ai: category, sms: category, calls: category }),
  allowance: caps,
  caps,
  /** The platform lets businesses choose their own limits within the allowance. */
  businessCaps: z.boolean(),
  canEdit: z.boolean(),
  paused: z.object({ outboundCalls: z.boolean(), sms: z.boolean(), ai: z.boolean() }),
  suspended: z.boolean(),
});

const settingsSchema = z.object({
  maxCapPence: caps,
  businessCaps: z.boolean(),
  costs: z.object({
    voicePencePerMinute: z.number().min(0).max(1000),
    phoneInboundPencePerMinute: z.number().min(0).max(1000),
    phoneOutboundPencePerMinute: z.number().min(0).max(1000),
    smsPencePerSegment: z.number().min(0).max(1000),
    usdToGbp: z.number().min(0.1).max(10),
  }),
  paused: z.object({ outboundCalls: z.boolean(), sms: z.boolean(), ai: z.boolean() }),
  // ADR 0031: any country with a pack (its rules and premium-number blocks).
  allowedCountries: z
    .array(z.string().refine((c) => SUPPORTED_COUNTRY_CODES.includes(c), "Unknown country"))
    .min(1)
    .max(SUPPORTED_COUNTRY_CODES.length),
});

async function savedCaps(deps: AppDeps, tenantId: string) {
  const [row] = await withTenant(deps.db, tenantId, (tx) =>
    tx
      .select({
        ai: agentSettings.aiCapPence,
        sms: agentSettings.smsCapPence,
        calls: agentSettings.callsCapPence,
      })
      .from(agentSettings)
      .where(eq(agentSettings.tenantId, tenantId)),
  );
  return row ?? { ai: 2000, sms: 1000, calls: 2000 };
}

export function registerSpendRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const params = z.object({ tenantId: z.string() });

  async function statusFor(tenantId: string, canEdit: boolean) {
    const [status, settings, saved, tenant] = await Promise.all([
      spendStatus(deps.db, tenantId),
      getPlatformSpendSettings(deps.db),
      savedCaps(deps, tenantId),
      withTenant(deps.db, tenantId, (tx) =>
        tx.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId)),
      ),
    ]);
    return {
      ...status,
      caps: saved,
      canEdit: canEdit && status.businessCaps,
      paused: settings.paused,
      suspended: tenant[0]?.status === "suspended",
    };
  }

  r.get(
    "/api/tenants/:tenantId/spend",
    {
      schema: {
        tags: ["spend"],
        summary: "This month's spend against the business's caps",
        params,
        response: { 200: statusResponse },
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "tenant:update",
      );
      return statusFor(access.tenantId, can(access.role, "billing:manage"));
    },
  );

  r.put(
    "/api/tenants/:tenantId/spend",
    {
      schema: {
        tags: ["spend"],
        summary: "Set the monthly caps (owners; within the allowance)",
        params,
        body: caps.partial(),
        response: { 200: statusResponse },
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "billing:manage",
      );
      if (!(await getPlatformSpendSettings(deps.db)).businessCaps) {
        throw new HttpError(
          409,
          "PLAN_LIMITS_ONLY",
          "Your limits come from your plan. Contact VoiceDesk support if you need more.",
        );
      }
      const allowance = await allowanceFor(deps.db, access.tenantId);
      for (const c of SPEND_CATEGORIES) {
        const value = request.body[c];
        if (value !== undefined && value > allowance[c]) {
          throw new HttpError(
            400,
            "ABOVE_ALLOWANCE",
            `The ${c === "sms" ? "texts" : c === "ai" ? "AI" : "calls"} limit can be at most £${(allowance[c] / 100).toFixed(2)} a month`,
          );
        }
      }
      const set = {
        ...(request.body.ai !== undefined ? { aiCapPence: request.body.ai } : {}),
        ...(request.body.sms !== undefined ? { smsCapPence: request.body.sms } : {}),
        ...(request.body.calls !== undefined ? { callsCapPence: request.body.calls } : {}),
      };
      if (Object.keys(set).length > 0) {
        await withTenant(deps.db, access.tenantId, async (tx) => {
          await tx
            .insert(agentSettings)
            .values({ tenantId: access.tenantId, ...set })
            .onConflictDoUpdate({ target: agentSettings.tenantId, set });
          await recordAudit(tx, {
            tenantId: access.tenantId,
            actorType: "user",
            actorUserId: access.session.user.id,
            action: "spend.caps_updated",
            metadata: { ...request.body },
            ipAddress: request.ip ?? null,
          });
        });
      }
      return statusFor(access.tenantId, true);
    },
  );

  r.get(
    "/api/platform/spend-settings",
    {
      schema: {
        tags: ["platform"],
        summary: "Spending rules, pause switches and every business's spend this month",
      },
    },
    async (request) => {
      const session = await requirePlatformOwner(deps, request);
      const settings = await getPlatformSpendSettings(deps.db);
      const businesses = await spendOverview(deps.db, session.user.id);
      return { settings, businesses };
    },
  );

  r.put(
    "/api/platform/spend-settings",
    {
      schema: {
        tags: ["platform"],
        summary: "Change the allowance, cost estimates, pause switches or allowed countries",
        body: settingsSchema.partial(),
      },
    },
    async (request) => {
      const session = await requirePlatformOwner(deps, request);
      const current = await getPlatformSpendSettings(deps.db);
      const next: PlatformSpendSettings = {
        maxCapPence: { ...current.maxCapPence, ...request.body.maxCapPence },
        businessCaps: request.body.businessCaps ?? current.businessCaps,
        costs: { ...current.costs, ...request.body.costs },
        paused: { ...current.paused, ...request.body.paused },
        allowedCountries: request.body.allowedCountries ?? current.allowedCountries,
      };
      await withPlatformAccess(
        deps.db,
        { actorUserId: session.user.id, reason: "spending settings" },
        (tx) =>
          tx
            .insert(platformSettings)
            .values({ id: "global", spend: next, updatedBy: session.user.id })
            .onConflictDoUpdate({
              target: platformSettings.id,
              set: { spend: next, updatedBy: session.user.id },
            }),
      );
      return { settings: next };
    },
  );

  r.put(
    "/api/platform/businesses/:tenantId/status",
    {
      schema: {
        tags: ["platform"],
        summary: "Suspend or resume a business",
        params,
        body: z.object({ status: z.enum(["active", "suspended"]) }),
      },
    },
    async (request) => {
      const session = await requirePlatformOwner(deps, request);
      const updated = await withPlatformAccess(
        deps.db,
        { actorUserId: session.user.id, reason: `business ${request.body.status}` },
        async (tx) => {
          const rows = await tx
            .update(tenants)
            .set({ status: request.body.status })
            .where(eq(tenants.id, request.params.tenantId))
            .returning({ id: tenants.id });
          if (rows.length > 0) {
            await recordAudit(tx, {
              tenantId: request.params.tenantId,
              actorType: "platform_owner",
              actorUserId: session.user.id,
              action: request.body.status === "suspended" ? "tenant.suspended" : "tenant.resumed",
              targetType: "tenant",
              targetId: request.params.tenantId,
              ipAddress: request.ip ?? null,
            });
          }
          return rows.length;
        },
      );
      if (!updated) throw notFound();
      return { status: request.body.status };
    },
  );
}
