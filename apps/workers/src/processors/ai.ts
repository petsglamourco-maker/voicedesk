import type { EmbeddingProvider, LlmProvider } from "@voicedesk/adapters";
import {
  buildDemoProfile,
  generateProfileDraft,
  processKnowledgeGaps,
  prepareCallSummaryEmails,
  summarizeConversation,
} from "@voicedesk/agent-brain";
import type { Logger } from "@voicedesk/compliance/logger";
import type { Database } from "@voicedesk/db";
import type { AiJob, Job, NotificationJob, SendEmailJob } from "@voicedesk/jobs";

export interface AiDeps {
  db: Database;
  llm: LlmProvider;
  /** Queues an email (the email worker sends it). */
  sendEmail: (job: SendEmailJob) => Promise<void>;
  /** Browser-facing origin for links in emails. */
  webOrigin: string;
  /** Local embeddings (ADR 0026: grouping unanswered questions). */
  embeddings?: EmbeddingProvider;
  /** Notifications queue (Phase 6: the rating link after a finished conversation). */
  notify?: (job: NotificationJob) => Promise<void>;
}

export function createAiProcessor(deps: AiDeps, log: Logger) {
  return async (job: Job<AiJob>) => {
    const data = job.data;
    switch (data.kind) {
      case "gaps.sweep": {
        if (!deps.embeddings) return { skipped: "no embeddings" };
        const result = await processKnowledgeGaps({
          db: deps.db,
          llm: deps.llm,
          embeddings: deps.embeddings,
        });
        if (result.grouped || result.drafted) {
          log.info({ jobId: job.id, ...result }, "unanswered questions processed");
        }
        return result;
      }
      case "demo.build": {
        const result = await buildDemoProfile(deps, data.tenantId);
        log.info({ jobId: job.id, tenantId: data.tenantId, ok: result.ok }, "demo built");
        return result;
      }
      case "profile.generate": {
        const { version } = await generateProfileDraft(deps, data.tenantId, data.requestedBy);
        log.info({ jobId: job.id, tenantId: data.tenantId, version }, "profile draft generated");
        return { version };
      }
      case "conversation.summarize": {
        const summary = await summarizeConversation(deps, data.tenantId, data.conversationId);
        log.info(
          {
            jobId: job.id,
            tenantId: data.tenantId,
            intent: summary.intent,
            by: summary.generatedBy,
          },
          "conversation summarised",
        );
        // Phone calls: tell the business straight away (target: within 60 s of hang-up).
        const emails = await prepareCallSummaryEmails(
          deps.db,
          data.tenantId,
          data.conversationId,
          deps.webOrigin,
        );
        for (const email of emails) {
          await deps.sendEmail({ ...email, tenantId: data.tenantId, kind: "call.summary" });
        }
        if (emails.length) {
          log.info({ jobId: job.id, recipients: emails.length }, "call summary emailed");
        }
        // Calls, emails and forms get a rating link (the planner checks settings and channel).
        await deps.notify?.({
          kind: "feedback.request",
          tenantId: data.tenantId,
          conversationId: data.conversationId,
        });
        return { intent: summary.intent, emailed: emails.length };
      }
    }
  };
}
