import {
  prepareDailyBrief,
  feedbackStats,
  feedbackThanks,
  loadAgentContext,
  offerReview,
  openReviewLink,
  recordFeedback,
  reviewInvite,
  shortSurveyQuestion,
  surveyByToken,
  toLang,
  type FeedbackKind,
} from "@voicedesk/agent-brain";
import { contacts, feedback, withTenant } from "@voicedesk/db";
import { and, desc, eq, gt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { notFound } from "../lib/errors";
import { requireTenantAccess } from "./guards";

/** Customer feedback (Phase 6, ADR 0020): public answers and the business's dashboard. */

export function registerFeedbackRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const token = z.object({ token: z.string().min(40).max(120) });

  r.get(
    "/api/public/feedback/:token",
    {
      schema: {
        tags: ["public feedback"],
        summary: "The rating question behind a link",
        params: token,
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const survey = await surveyByToken(deps.db, request.params.token);
      if (!survey) throw notFound();
      const ctx = await loadAgentContext(deps.db, survey.tenantId, "chat");
      const lang = toLang(survey.language, "en");
      return {
        businessName: ctx.businessName,
        kind: survey.kind,
        question: shortSurveyQuestion(lang, survey.kind as FeedbackKind, ctx.businessName),
        answered: survey.score !== null,
        language: lang,
      };
    },
  );

  r.post(
    "/api/public/feedback/:token",
    {
      schema: {
        tags: ["public feedback"],
        summary: "Answer a rating (one answer; a comment can follow)",
        params: token,
        body: z.object({
          score: z.number().int().min(0).max(10).optional(),
          comment: z.string().trim().max(1000).optional(),
        }),
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const survey = await surveyByToken(deps.db, request.params.token);
      if (!survey) throw notFound();
      const saved = await recordFeedback(deps.db, survey.tenantId, survey.id, request.body);
      if (!saved) throw notFound();
      if (saved.low) {
        await deps.jobs.notify({
          kind: "staff.alert",
          tenantId: survey.tenantId,
          record: "feedback",
          id: survey.id,
        });
      }
      const lang = toLang(survey.language, "en");
      // ADR 0028: everyone who answers may be invited to review, whatever the score.
      const review = saved.first ? await offerReview(deps.db, survey.tenantId, survey.id) : null;
      if (!review) return { thanks: feedbackThanks(lang), low: saved.low };
      const ctx = await loadAgentContext(deps.db, survey.tenantId, "chat");
      return {
        thanks: feedbackThanks(lang),
        low: saved.low,
        review: {
          url: review.path,
          text: reviewInvite(lang, ctx.businessName),
        },
      };
    },
  );

  r.get(
    "/api/public/review/:token",
    {
      schema: {
        tags: ["public feedback"],
        summary: "Opens the business's review page (tracked; only after an invitation)",
        params: token,
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const link = await openReviewLink(deps.db, request.params.token);
      if (!link) throw notFound();
      return reply.redirect(link, 302);
    },
  );

  r.get(
    "/api/tenants/:tenantId/daily-brief/preview",
    {
      schema: {
        tags: ["feedback"],
        summary: "Today's daily brief as it would be emailed (nothing is sent)",
        params: z.object({ tenantId: z.string() }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "records:read",
      );
      const brief = await prepareDailyBrief(
        deps.db,
        access.tenantId,
        new Date(),
        deps.webOrigin ?? "http://localhost:3000",
      );
      if (!brief) throw notFound();
      return { subject: brief.subject, text: brief.text, recipients: brief.to.length };
    },
  );

  r.get(
    "/api/tenants/:tenantId/feedback",
    {
      schema: {
        tags: ["feedback"],
        summary: "Ratings: CSAT, NPS, by channel and by who handled it, latest comments",
        params: z.object({ tenantId: z.string() }),
        querystring: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "records:read",
      );
      const since = new Date(Date.now() - request.query.days * 24 * 3600 * 1000);
      const rows = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .select({ f: feedback, contactName: contacts.fullName })
          .from(feedback)
          .leftJoin(contacts, eq(contacts.id, feedback.contactId))
          .where(and(eq(feedback.tenantId, access.tenantId), gt(feedback.sentAt, since)))
          .orderBy(desc(feedback.sentAt)),
      );
      const plain = rows.map((r) => r.f);
      const group = (key: "channel" | "handledBy") => {
        const values = [...new Set(plain.map((f) => f[key]))].sort();
        return values.map((value) => ({
          [key]: value,
          ...feedbackStats(plain.filter((f) => f[key] === value)),
        }));
      };
      return {
        days: request.query.days,
        overall: feedbackStats(plain),
        byChannel: group("channel"),
        byHandler: group("handledBy"),
        latest: rows
          .filter((r) => r.f.score !== null)
          .slice(0, 30)
          .map(({ f, contactName }) => ({
            id: f.id,
            conversationId: f.conversationId,
            channel: f.channel,
            kind: f.kind,
            score: f.score,
            comment: f.comment,
            handledBy: f.handledBy,
            contactName,
            answeredAt: f.answeredAt,
          })),
      };
    },
  );
}
