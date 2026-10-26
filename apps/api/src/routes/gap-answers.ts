import { approveGapAnswer, dismissGapAnswer, pendingGapAnswers } from "@voicedesk/agent-brain";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { notFound } from "../lib/errors";
import { requireTenantAccess } from "./guards";

/**
 * Questions to answer (ADR 0026): unanswered questions grouped by meaning, with drafted
 * answers. A person approves (and may edit) one, and it becomes an FAQ in the live profile.
 */

const params = z.object({ tenantId: z.string() });
const itemParams = params.extend({ id: z.string().uuid() });

export function registerGapAnswerRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["knowledge"];

  r.get(
    "/api/tenants/:tenantId/gap-answers",
    {
      schema: {
        tags,
        summary: "Questions the assistant couldn't answer, grouped, with drafts",
        params,
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "knowledge:read",
      );
      return { questions: await pendingGapAnswers(deps.db, access.tenantId) };
    },
  );

  r.post(
    "/api/tenants/:tenantId/gap-answers/:id/approve",
    {
      schema: {
        tags,
        summary: "Approve an answer: it becomes an FAQ in the live business profile",
        params: itemParams,
        body: z.object({
          question: z.string().trim().min(3).max(300),
          answer: z.string().trim().min(2).max(1000),
        }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "knowledge:write",
      );
      const done = await approveGapAnswer(
        deps.db,
        access.tenantId,
        request.params.id,
        request.body,
        access.session.user.id,
      );
      if (!done) throw notFound();
      return { ok: true, profileVersion: done.version };
    },
  );

  r.post(
    "/api/tenants/:tenantId/gap-answers/:id/dismiss",
    {
      schema: {
        tags,
        summary: "Dismiss a question that doesn't need an answer",
        params: itemParams,
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "knowledge:write",
      );
      const ok = await dismissGapAnswer(
        deps.db,
        access.tenantId,
        request.params.id,
        access.session.user.id,
      );
      if (!ok) throw notFound();
      return { ok: true };
    },
  );
}
