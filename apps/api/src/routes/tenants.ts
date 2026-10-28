import { voiceTypingOn } from "./voice-typing";
import { randomBytes } from "node:crypto";
import {
  createBusinessSchema,
  createTenantProfile,
  getTenant,
  permissionsFor,
  PERMISSIONS,
  getCountrySettings,
  launchedCountries,
} from "@voicedesk/core";
import { auditLog, withTenant } from "@voicedesk/db";
import { fromNodeHeaders } from "better-auth/node";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { requireSession, requireTenantAccess } from "./guards";

const tenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  countryCode: z.string(),
  timezone: z.string(),
  defaultLanguage: z.string(),
  dataRegion: z.string(),
  status: z.enum(["onboarding", "active", "suspended"]),
  createdAt: z.date(),
});

const tenantParams = z.object({ tenantId: z.string() });

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "business"}-${randomBytes(3).toString("hex")}`;
}

export function registerTenantRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/api/tenants",
    {
      schema: {
        tags: ["tenants"],
        summary: "Create a business (tenant); the caller becomes its owner",
        security: [{ session: [] }],
        body: createBusinessSchema,
        response: { 201: tenantSchema },
      },
    },
    async (request, reply) => {
      const session = await requireSession(deps.auth, request);
      // ADR 0031: only launched countries (a pack in code isn't a launch).
      const countries = deps.countrySettings ?? (await getCountrySettings(deps.db));
      if (!launchedCountries(countries).includes(request.body.countryCode)) {
        throw new HttpError(
          400,
          "COUNTRY_NOT_LAUNCHED",
          "VoiceDesk isn't available in that country yet",
        );
      }
      const headers = fromNodeHeaders(request.headers);
      const org = await deps.auth.api.createOrganization({
        headers,
        body: { name: request.body.name, slug: slugify(request.body.name) },
      });
      if (!org) throw new Error("organization creation returned no result");

      try {
        const tenant = await createTenantProfile(deps.db, {
          tenantId: org.id,
          actorUserId: session.user.id,
          input: request.body,
          ip: request.ip,
        });
        return reply.status(201).send(tenant);
      } catch (error) {
        // Compensate so we never leave an organization without a tenant profile.
        await deps.auth.api
          .deleteOrganization({ headers, body: { organizationId: org.id } })
          .catch((cleanupError: unknown) =>
            request.log.error({ err: cleanupError, tenantId: org.id }, "org cleanup failed"),
          );
        throw error;
      }
    },
  );

  r.get(
    "/api/tenants/:tenantId",
    {
      schema: {
        tags: ["tenants"],
        security: [{ session: [] }],
        params: tenantParams,
        response: {
          200: z.object({
            tenant: tenantSchema,
            role: z.string(),
            permissions: z.array(z.enum(PERMISSIONS)),
            /** ADR 0027: show the microphone in text fields for this person here. */
            voiceTyping: z.boolean(),
          }),
        },
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "tenant:read",
      );
      const tenant = await getTenant(deps.db, access.tenantId);
      if (!tenant) throw notFound();
      return {
        tenant,
        role: access.role,
        permissions: permissionsFor(access.role),
        voiceTyping: await voiceTypingOn(deps, access.tenantId, access.session.user.id),
      };
    },
  );

  r.get(
    "/api/tenants/:tenantId/audit",
    {
      schema: {
        tags: ["tenants"],
        summary: "Recent audit log entries for a business",
        security: [{ session: [] }],
        params: tenantParams,
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
        response: {
          200: z.array(
            z.object({
              id: z.number(),
              actorType: z.string(),
              actorUserId: z.string().nullable(),
              action: z.string(),
              targetType: z.string().nullable(),
              targetId: z.string().nullable(),
              metadata: z.record(z.string(), z.unknown()),
              createdAt: z.date(),
            }),
          ),
        },
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "audit:read",
      );
      return withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .select({
            id: auditLog.id,
            actorType: auditLog.actorType,
            actorUserId: auditLog.actorUserId,
            action: auditLog.action,
            targetType: auditLog.targetType,
            targetId: auditLog.targetId,
            metadata: auditLog.metadata,
            createdAt: auditLog.createdAt,
          })
          .from(auditLog)
          .where(eq(auditLog.tenantId, access.tenantId))
          .orderBy(desc(auditLog.createdAt))
          .limit(request.query.limit),
      );
    },
  );
}
