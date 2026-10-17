import type { EmailProvider, SmsProvider } from "@voicedesk/adapters";
import {
  planBookingNotification,
  planBookingReminder,
  planStaffAlert,
  type NotificationPlan,
} from "@voicedesk/agent-brain";
import type { Logger } from "@voicedesk/compliance/logger";
import type { Database } from "@voicedesk/db";
import { reminderJobId, type Job, type NotificationJob } from "@voicedesk/jobs";

export interface NotificationDeps {
  db: Database;
  sms: SmsProvider;
  email: EmailProvider;
  /** Sender shown on texts: an alphanumeric ID (e.g. "VoiceDesk") or an E.164 number. */
  smsFrom: string;
  webOrigin: string;
  /** Reminder scheduling (BullMQ delayed jobs keyed by reminderJobId). */
  reminders: {
    schedule: (
      job: Extract<NotificationJob, { kind: "booking.reminder" }>,
      runAt: Date,
    ) => Promise<void>;
    remove: (bookingId: string) => Promise<void>;
  };
}

/** Sends what the planner decided; never logs message text or numbers (PII). */
export function createNotificationProcessor(deps: NotificationDeps, log: Logger) {
  async function execute(job: Job<NotificationJob>, tenantId: string, plan: NotificationPlan) {
    for (const m of plan.messages) {
      if (m.channel === "sms") {
        await deps.sms.send({ to: m.to, from: deps.smsFrom, body: m.text });
      } else {
        await deps.email.send({
          to: m.to,
          subject: m.subject ?? "",
          text: m.text,
          tags: { tenantId, kind: m.kind },
        });
      }
    }
    if (plan.reminder?.action === "schedule") {
      const r = plan.reminder;
      await deps.reminders.schedule(
        {
          kind: "booking.reminder",
          tenantId,
          bookingId: r.bookingId,
          startsAt: r.startsAt,
          language: r.language,
        },
        r.runAt,
      );
    } else if (plan.reminder?.action === "remove") {
      await deps.reminders.remove(plan.reminder.bookingId);
    }
    log.info(
      {
        jobId: job.id,
        tenantId,
        kind: job.data.kind,
        sms: plan.messages.filter((m) => m.channel === "sms").length,
        emails: plan.messages.filter((m) => m.channel === "email").length,
        reminder: plan.reminder?.action ?? null,
      },
      "notification processed",
    );
    return { sent: plan.messages.length };
  }

  return async (job: Job<NotificationJob>) => {
    const data = job.data;
    switch (data.kind) {
      case "booking.changed":
        return execute(job, data.tenantId, await planBookingNotification(deps.db, data));
      case "booking.reminder":
        return execute(job, data.tenantId, await planBookingReminder(deps.db, data));
      case "staff.alert":
        return execute(job, data.tenantId, await planStaffAlert(deps.db, data, deps.webOrigin));
    }
  };
}

export { reminderJobId };
