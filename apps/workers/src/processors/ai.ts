import type { LlmProvider } from "@voicedesk/adapters";
import { generateProfileDraft, summarizeConversation } from "@voicedesk/agent-brain";
import type { Logger } from "@voicedesk/compliance/logger";
import type { Database } from "@voicedesk/db";
import type { AiJob, Job } from "@voicedesk/jobs";

export interface AiDeps {
  db: Database;
  llm: LlmProvider;
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
        return { intent: summary.intent };
      }
    }
  };
}
