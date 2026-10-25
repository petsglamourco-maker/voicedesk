import type { EmailProvider, PushProvider, SmsProvider } from "@voicedesk/adapters";
import {
  checkSend,
  claimDueBriefs,
  getPlatformSpendSettings,
  recordSmsSpend,
  smsCostsMoney,
  smsSegments,
  scheduleCallbackFor,
  scheduleConfirmationFor,
  planBookingNotification,
  prepareDailyBrief,
  planBookingReminder,
  planFeedbackRequest,
  planSpendAlerts,
  planStaffAlert,
  planRingingPush,
  planSupportRequest,
  planTransferContext,
  type NotificationPlan,
} from "@voicedesk/agent-brain";
import type { Logger } from "@voicedesk/compliance/logger";
import { sendPush, type SecretBox } from "@voicedesk/core";
import type { Database } from "@voicedesk/db";
import { reminderJobId, type Job, type NotificationJob } from "@voicedesk/jobs";

export interface NotificationDeps {
  db: Database;
  sms: SmsProvider;
  email: EmailProvider;
  /** Web push to phones (ADR 0024); null until VAPID keys are set (pushes are skipped). */
  push?: { provider: PushProvider | null; box: SecretBox | null };
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
    const skipped: string[] = [];
    const settings = plan.messages.some((m) => m.channel === "sms")
      ? await getPlatformSpendSettings(deps.db)
      : undefined;
    let pushed = 0;
    for (const m of plan.messages) {
      if (m.channel === "push") {
        // Free and carries no customer details; a failure never stops the emails and texts.
        const push = deps.push;
        if (!push?.provider || !push.box) continue;
        try {
          const result = await sendPush(
            { db: deps.db, box: push.box, push: push.provider },
            [m.to],
            {
              title: m.subject ?? "VoiceDesk",
              body: m.text,
              path: m.path ?? "/today",
              ...(m.tag ? { tag: m.tag } : {}),
              ...(m.urgent ? { urgent: true } : {}),
            },
          );
          pushed += result.sent;
        } catch (error) {
          log.warn({ jobId: job.id, err: (error as Error).name }, "push failed");
        }
        continue;
      }
      if (m.channel === "sms") {
        // Every text: pause switches, suspension, the business's cap, allowed destinations
        // (ADR 0022). Refused texts are skipped; emails in the same plan still go.
        const decision =
          tenantId === "platform"
            ? ({ ok: false, reason: "invalid" } as const)
            : await checkSend(deps.db, { tenantId, kind: "sms", to: m.to, settings });
        if (!decision.ok) {
          skipped.push(decision.reason);
          continue;
        }
        await deps.sms.send({ to: m.to, from: deps.smsFrom, body: m.text });
        if (smsCostsMoney(deps.sms.name)) {
          await recordSmsSpend(deps.db, tenantId, smsSegments(m.text), settings);
        }
      } else {
        await deps.email.send({
          to: m.to,
          subject: m.subject ?? "",
          text: m.text,
          ...(m.replyTo ? { replyTo: m.replyTo } : {}),
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
        sms: plan.messages.filter((m) => m.channel === "sms").length - skipped.length,
        smsSkipped: skipped,
        emails: plan.messages.filter((m) => m.channel === "email").length,
        pushes: pushed,
        reminder: plan.reminder?.action ?? null,
      },
      "notification processed",
    );
    return { sent: plan.messages.length - skipped.length, skipped };
  }

  return async (job: Job<NotificationJob>) => {
    const data = job.data;
    if (data.kind === "brief.tick") {
      const now = new Date();
      const due = await claimDueBriefs(deps.db, now);
      for (const tenantId of due) {
        const brief = await prepareDailyBrief(deps.db, tenantId, now, deps.webOrigin);
        if (!brief) continue;
        await execute(job, tenantId, {
          messages: brief.to.map((to) => ({
            channel: "email",
            to,
            subject: brief.subject,
            text: brief.text,
            kind: "daily.brief",
          })),
        });
      }
      // Spending alerts share the 15-minute tick (ADR 0022).
      const alerts = await planSpendAlerts(deps.db, now, deps.webOrigin);
      for (const { tenantId, plan } of alerts) await execute(job, tenantId, plan);
      return { briefs: due.length, spendAlerts: alerts.length };
    }
    switch (data.kind) {
      case "booking.changed":
        return execute(job, data.tenantId, await planBookingNotification(deps.db, data));
      case "booking.reminder":
        // Confirmation calls (Phase 6) replace the reminder text when switched on.
        if (await scheduleConfirmationFor(deps.db, data.tenantId, data.bookingId, data.language)) {
          return { confirmationCall: true };
        }
        return execute(job, data.tenantId, await planBookingReminder(deps.db, data));
      case "feedback.request":
        return execute(
          job,
          data.tenantId,
          await planFeedbackRequest(deps.db, data, deps.webOrigin),
        );
      case "staff.alert": {
        // A callback request: the assistant calls back too, when the business switched it on.
        if (data.record === "ticket" || data.record === "message") {
          await scheduleCallbackFor(deps.db, data.tenantId, { type: data.record, id: data.id });
        }
        return execute(job, data.tenantId, await planStaffAlert(deps.db, data, deps.webOrigin));
      }
      case "transfer.context":
        return execute(job, data.tenantId, await planTransferContext(deps.db, data));
      case "call.ringing":
        return execute(job, data.tenantId, await planRingingPush(deps.db, data));
      case "support.request":
        return execute(job, "platform", await planSupportRequest(deps.db, data, deps.webOrigin));
    }
  };
}

export { reminderJobId };
