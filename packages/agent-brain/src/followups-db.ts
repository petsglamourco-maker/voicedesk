import { getPlanState, planAllows } from "@voicedesk/core";
import {
  agentSettings,
  bookings,
  conversationMessages,
  followUps,
  organization,
  publicEndpoints,
  withTenant,
  type Database,
  type Tx,
} from "@voicedesk/db";
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { ATTRIBUTION_MS } from "./followups";
import { toLang, type Lang } from "./languages";
import type { NotificationPlan } from "./notifications";

/**
 * Follow-ups (ADR 0026), database side: claim the ones that are due, decide whether each
 * should still go, write the message, and credit bookings that follow.
 */

export type FollowUpRow = typeof followUps.$inferSelect;

/** Due follow-ups, claimed (scheduled → sending) so two workers never send one twice. */
export async function claimDueFollowUps(
  db: Database,
  now: Date,
  /** Limit to these businesses (tests); by default every business. */
  only?: string[],
): Promise<FollowUpRow[]> {
  const all = await db
    .select({ id: organization.id })
    .from(organization)
    .where(only ? inArray(organization.id, only) : undefined);
  const claimed: FollowUpRow[] = [];
  for (const { id } of all) {
    const rows = await withTenant(db, id, (tx) =>
      tx
        .update(followUps)
        .set({ status: "sending" })
        .where(
          and(
            eq(followUps.tenantId, id),
            eq(followUps.status, "scheduled"),
            lte(followUps.sendAt, now),
          ),
        )
        .returning(),
    );
    claimed.push(...rows);
  }
  return claimed;
}

/** sending → sent / skipped (conditional, like every status change). */
export async function finishFollowUp(
  db: Database,
  row: FollowUpRow,
  result: { status: "sent" | "skipped"; reason?: string },
  now: Date = new Date(),
): Promise<void> {
  await withTenant(db, row.tenantId, (tx) =>
    tx
      .update(followUps)
      .set({
        status: result.status,
        reason: result.reason ?? null,
        sentAt: result.status === "sent" ? now : null,
      })
      .where(and(eq(followUps.id, row.id), eq(followUps.status, "sending"))),
  );
}

const MESSAGE: Record<
  Lang,
  (a: { name: string | null; business: string; topic: string; phone: string | null }) => string
> = {
  en: (a) =>
    `Hi${a.name ? ` ${a.name}` : ""}, it's ${a.business}. Thanks for asking about ${a.topic}. If you'd like to book, ${a.phone ? `call us on ${a.phone}` : "just reply"} and we'll find you a time. This is a one-off message.`,
  es: (a) =>
    `Hola${a.name ? ` ${a.name}` : ""}, le escribimos de ${a.business}. Gracias por preguntar por ${a.topic}. Si desea reservar, ${a.phone ? `llámenos al ${a.phone}` : "responda a este mensaje"} y le buscaremos una hora. Este es un mensaje único.`,
  fr: (a) =>
    `Bonjour${a.name ? ` ${a.name}` : ""}, c'est ${a.business}. Merci pour votre demande concernant ${a.topic}. Pour prendre rendez-vous, ${a.phone ? `appelez-nous au ${a.phone}` : "répondez simplement"} et nous trouverons un créneau. Ce message est unique.`,
  de: (a) =>
    `Hallo${a.name ? ` ${a.name}` : ""}, hier ist ${a.business}. Danke für Ihre Anfrage zu ${a.topic}. Wenn Sie einen Termin möchten, ${a.phone ? `rufen Sie uns unter ${a.phone} an` : "antworten Sie einfach"} und wir finden eine Zeit. Dies ist eine einmalige Nachricht.`,
  zh: (a) =>
    `${a.name ? `${a.name}，` : ""}您好，这里是${a.business}。感谢您咨询${a.topic}。如需预约，${a.phone ? `请致电 ${a.phone}` : "请直接回复"}，我们会为您安排时间。本消息仅发送一次。`,
  ar: (a) =>
    `مرحباً${a.name ? ` ${a.name}` : ""}، معك ${a.business}. شكراً لاستفسارك عن ${a.topic}. إذا رغبت في الحجز، ${a.phone ? `اتصل بنا على ${a.phone}` : "رد على هذه الرسالة"} وسنجد لك موعداً. هذه رسالة لمرة واحدة.`,
};

export function followUpText(
  lang: Lang,
  a: { name: string | null; business: string; topic: string; phone: string | null },
): string {
  return MESSAGE[lang](a);
}

/**
 * The message for a due follow-up, or why it shouldn't go any more: switched off, not in the
 * plan, they booked since, or WhatsApp's 24-hour window has passed.
 */
export async function prepareFollowUp(
  db: Database,
  row: FollowUpRow,
  context: { businessName: string; contactPhone: string | null },
  now: Date = new Date(),
): Promise<{ plan: NotificationPlan } | { skip: string }> {
  const state = await withTenant(db, row.tenantId, async (tx) => {
    const [settings] = await tx
      .select({ on: agentSettings.followUps })
      .from(agentSettings)
      .where(eq(agentSettings.tenantId, row.tenantId));
    const [booked] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, row.tenantId),
          gte(bookings.createdAt, row.createdAt),
          or(
            row.contactId ? eq(bookings.contactId, row.contactId) : undefined,
            eq(bookings.customerPhone, row.to),
            eq(bookings.customerEmail, row.to),
          ),
        ),
      )
      .limit(1);
    const [lastCaller] = await tx
      .select({ at: conversationMessages.createdAt })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, row.conversationId),
          eq(conversationMessages.role, "caller"),
        ),
      )
      .orderBy(desc(conversationMessages.id))
      .limit(1);
    const [wa] =
      row.channel === "whatsapp"
        ? await tx
            .select({ key: publicEndpoints.key })
            .from(publicEndpoints)
            .where(
              and(
                eq(publicEndpoints.tenantId, row.tenantId),
                eq(publicEndpoints.kind, "whatsapp"),
                eq(publicEndpoints.enabled, true),
              ),
            )
            .limit(1)
        : [];
    return { on: settings?.on ?? false, booked: Boolean(booked), lastCaller, wa };
  });
  if (!state.on) return { skip: "switched_off" };
  if (!planAllows(await getPlanState(db, row.tenantId), "follow_ups")) return { skip: "plan" };
  if (state.booked) return { skip: "booked" };
  if (row.channel === "whatsapp") {
    const last = state.lastCaller?.at ?? row.createdAt;
    if (now.getTime() - last.getTime() > 24 * 3_600_000) return { skip: "whatsapp_window" };
    if (!state.wa) return { skip: "whatsapp_off" };
  }
  const text = followUpText(toLang(row.language, "en"), {
    name: row.name,
    business: context.businessName,
    topic: row.topic,
    phone: row.channel === "whatsapp" ? null : context.contactPhone,
  });
  const message =
    row.channel === "sms"
      ? { channel: "sms" as const, to: row.to, text, kind: "follow_up" }
      : row.channel === "email"
        ? {
            channel: "email" as const,
            to: row.to,
            subject: context.businessName,
            text,
            kind: "follow_up",
          }
        : {
            channel: "whatsapp" as const,
            to: row.to,
            from: state.wa!.key,
            text,
            kind: "follow_up",
          };
  return { plan: { messages: [message] } };
}

/**
 * A booking made within 7 days of a follow-up to the same person counts as won by it.
 * Called inside the booking's own transaction.
 */
export async function creditFollowUp(
  tx: Tx,
  booking: {
    id: string;
    tenantId: string;
    contactId: string | null;
    customerPhone: string | null;
    customerEmail: string | null;
  },
  now: Date = new Date(),
): Promise<void> {
  const who = [
    booking.contactId ? eq(followUps.contactId, booking.contactId) : undefined,
    booking.customerPhone ? eq(followUps.to, booking.customerPhone) : undefined,
    booking.customerEmail ? eq(followUps.to, booking.customerEmail) : undefined,
  ].filter((c) => c !== undefined);
  if (who.length === 0) return;
  await tx
    .update(followUps)
    .set({ bookingId: booking.id })
    .where(
      and(
        eq(followUps.tenantId, booking.tenantId),
        eq(followUps.status, "sent"),
        isNull(followUps.bookingId),
        gte(followUps.sentAt, new Date(now.getTime() - ATTRIBUTION_MS)),
        or(...who),
      ),
    );
}

/** This month's follow-ups for Today and the dashboard. */
export async function followUpCounts(
  db: Database,
  tenantId: string,
  since: Date,
): Promise<{ sent: number; booked: number; scheduled: number }> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        sent: sql<number>`count(*) filter (where ${followUps.status} = 'sent' and ${followUps.sentAt} >= ${since})::int`,
        booked: sql<number>`count(*) filter (where ${followUps.bookingId} is not null and ${followUps.sentAt} >= ${since})::int`,
        scheduled: sql<number>`count(*) filter (where ${followUps.status} = 'scheduled')::int`,
      })
      .from(followUps)
      .where(eq(followUps.tenantId, tenantId)),
  );
  return row ?? { sent: 0, booked: 0, scheduled: 0 };
}
