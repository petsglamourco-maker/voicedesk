import type { LlmProvider } from "@voicedesk/adapters";
import {
  generateProfileDraft,
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
  /** Notifications queue (Phase 6: the rating link after a finished conversation). */
  notify?: (job: NotificationJob) => Promise<void>;
}

export function createAiProcessor(deps: AiDeps, log: Logger) {
  return async (job: Job<AiJob>) => {
    const data = job.data;
    switch (data.kind) {
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
