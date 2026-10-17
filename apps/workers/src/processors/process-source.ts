import type { Logger } from "@voicedesk/compliance/logger";
import type { Job, ProcessSourceJob } from "@voicedesk/jobs";
import { processSource, type KnowledgeDeps } from "@voicedesk/knowledge";

export function createProcessSourceProcessor(deps: KnowledgeDeps, log: Logger) {
  return async (job: Job<ProcessSourceJob>) => {
    const { tenantId, sourceId } = job.data;
    log.info({ jobId: job.id, tenantId, sourceId, name: job.name }, "processing knowledge source");
    return processSource(deps, tenantId, sourceId);
  };
}
