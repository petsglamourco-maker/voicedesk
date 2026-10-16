import type { EmailProvider } from "@voicedesk/adapters";
import type { Logger } from "@voicedesk/compliance/logger";
import type { Job, SendEmailJob } from "@voicedesk/jobs";

export function createSendEmailProcessor(email: EmailProvider, log: Logger) {
  return async (job: Job<SendEmailJob>): Promise<{ messageId: string }> => {
    const { to, subject, text, html, tenantId, kind } = job.data;
    const { id } = await email.send({
      to,
      subject,
      text,
      html,
      tags: { kind, ...(tenantId ? { tenantId } : {}) },
    });
    // Log ids and kind only — never recipient addresses or content.
    log.info({ jobId: job.id, kind, tenantId, messageId: id }, "email sent");
    return { messageId: id };
  };
}
