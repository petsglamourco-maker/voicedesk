import { isDemoTenant, setDemoStatus } from "@voicedesk/agent-brain";
import type { Logger } from "@voicedesk/compliance/logger";
import type { AiJob, Job, ProcessSourceJob } from "@voicedesk/jobs";
import { processSource, type KnowledgeDeps } from "@voicedesk/knowledge";

export function createProcessSourceProcessor(
  deps: KnowledgeDeps & {
    /** ADR 0029: queues the AI step of an instant demo once its site is read. */
    enqueueAi?: (job: AiJob) => Promise<void>;
  },
  log: Logger,
) {
  return async (job: Job<ProcessSourceJob>) => {
    const { tenantId, sourceId } = job.data;
    log.info({ jobId: job.id, tenantId, sourceId, name: job.name }, "processing knowledge source");
    if (!(await isDemoTenant(deps.db, tenantId))) return processSource(deps, tenantId, sourceId);
    // Instant demo: one attempt, then the profile (a failed crawl ends the demo, no retries).
    try {
      const stats = await processSource(deps, tenantId, sourceId);
      await deps.enqueueAi?.({ kind: "demo.build", tenantId });
      return stats;
    } catch (error) {
      log.warn({ jobId: job.id, tenantId, err: (error as Error).name }, "demo crawl failed");
      await setDemoStatus(deps.db, tenantId, "failed", "crawl_failed");
      return { failed: true };
    }
  };
}
