import {
  approveVersion,
  businessProfileSchema,
  emptyProfile,
  getProfiles,
  saveDraft,
} from "@voicedesk/agent-brain";
import { getTenant } from "@voicedesk/core";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { requireTenantAccess } from "./guards";

const versionSchema = z.object({
  version: z.number(),
  status: z.enum(["draft", "approved", "superseded"]),
  data: businessProfileSchema,
  generatedBy: z.string(),
  createdAt: z.date(),
  approvedAt: z.date().nullable(),
});

const params = z.object({ tenantId: z.string() });

export function registerProfileRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["profile"];

  r.get(
    "/api/tenants/:tenantId/profile",
    {
      schema: {
        tags,
        summary: "Approved business profile, current draft, and a blank template",
        params,
        response: {
          200: z.object({
            approved: versionSchema.nullable(),
            draft: versionSchema.nullable(),
            template: businessProfileSchema,
            aiAvailable: z.boolean(),
          }),
        },
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "knowledge:read",
      );
      const tenant = await getTenant(deps.db, access.tenantId);
      if (!tenant) throw notFound();
      return {
        ...(await getProfiles(deps.db, access.tenantId)),
        template: emptyProfile(tenant.name),
        aiAvailable: deps.llm.name !== "mock-llm",
      };
    },
  );

  r.post(
    "/api/tenants/:tenantId/profile/generate",
    { schema: { tags, summary: "Generate a new draft from the knowledge base (AI)", params } },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "knowledge:write",
      );
      if (deps.llm.name === "mock-llm") {
        throw new HttpError(
          409,
          "AI_NOT_CONFIGURED",
          "Add an Anthropic API key to generate profiles",
        );
      }
      await deps.jobs.enqueueAi({
        kind: "profile.generate",
        tenantId: access.tenantId,
        requestedBy: access.session.user.id,
      });
      return reply.status(202).send({ status: "queued" });
    },
  );

  r.put(
    "/api/tenants/:tenantId/profile/draft",
    {
      schema: {
        tags,
        summary: "Save edits as the current draft",
        params,
        body: businessProfileSchema,
        response: { 200: z.object({ version: z.number() }) },
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "knowledge:write",
      );
      const version = await saveDraft(
        deps.db,
        access.tenantId,
        request.body,
        access.session.user.id,
      );
      return { version };
    },
  );

  r.post(
    "/api/tenants/:tenantId/profile/approve",
    {
      schema: {
        tags,
        summary: "Make a draft version the live profile the agent uses",
        params,
        body: z.object({ version: z.number().int().positive() }),
      },
    },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "knowledge:write",
      );
      const ok = await approveVersion(
        deps.db,
        access.tenantId,
        request.body.version,
        access.session.user.id,
      );
      if (!ok) throw new HttpError(409, "NOT_A_DRAFT", "That version is not a draft");
      return reply.status(204).send();
    },
  );
}
