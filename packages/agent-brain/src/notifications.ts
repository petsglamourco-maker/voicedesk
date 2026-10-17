import {
  agentSettings,
  bookings,
  conversations,
  member,
  phoneNumbers,
  staffMessages,
  tenants,
  tickets,
  user,
  withTenant,
  type Database,
} from "@voicedesk/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { toLang, type Lang } from "./languages";
import { getApprovedProfile } from "./profile-store";

/**
 * Customer confirmations, reminders and staff alerts (Phase 3, ADR 0015). Pure text builders
 * plus a planner that reads the database and decides who gets what; the notifications worker
 * only sends and schedules. Transactional messages only: no marketing.
 */

export type BookingChange = "created" | "moved" | "cancelled" | "reminder";

interface BookingText {
  business: string;
  service: string;
  when: string;
  reference: string;
  contactPhone: string | null;
}

const T: Record<
  Lang,
  {
    created: (b: BookingText) => string;
    moved: (b: BookingText) => string;
    cancelled: (b: BookingText) => string;
    reminder: (b: BookingText) => string;
    change: (phone: string) => string;
    subject: Record<BookingChange, (business: string) => string>;
  }
> = {
  en: {
    created: (b) => `${b.business}: your ${b.service} is booked for ${b.when}. Ref ${b.reference}.`,
    moved: (b) => `${b.business}: your ${b.service} has moved to ${b.when}. Ref ${b.reference}.`,
    cancelled: (b) =>
      `${b.business}: your ${b.service} on ${b.when} is cancelled. Ref ${b.reference}.`,
    reminder: (b) =>
      `Reminder from ${b.business}: your ${b.service} is on ${b.when}. Ref ${b.reference}.`,
    change: (p) => ` To change it, call ${p}.`,
    subject: {
      created: (n) => `${n}: booking confirmed`,
      moved: (n) => `${n}: booking moved`,
      cancelled: (n) => `${n}: booking cancelled`,
      reminder: (n) => `${n}: appointment reminder`,
    },
  },
  es: {
    created: (b) =>
      `${b.business}: su ${b.service} está reservada para el ${b.when}. Ref. ${b.reference}.`,
    moved: (b) =>
      `${b.business}: su ${b.service} se ha cambiado al ${b.when}. Ref. ${b.reference}.`,
    cancelled: (b) =>
      `${b.business}: su ${b.service} del ${b.when} está cancelada. Ref. ${b.reference}.`,
    reminder: (b) =>
      `Recordatorio de ${b.business}: su ${b.service} es el ${b.when}. Ref. ${b.reference}.`,
    change: (p) => ` Para cambiarla, llame al ${p}.`,
    subject: {
      created: (n) => `${n}: reserva confirmada`,
      moved: (n) => `${n}: reserva cambiada`,
      cancelled: (n) => `${n}: reserva cancelada`,
      reminder: (n) => `${n}: recordatorio de cita`,
    },
  },
  fr: {
    created: (b) =>
      `${b.business} : votre ${b.service} est réservé(e) le ${b.when}. Réf. ${b.reference}.`,
    moved: (b) =>
      `${b.business} : votre ${b.service} est déplacé(e) au ${b.when}. Réf. ${b.reference}.`,
    cancelled: (b) =>
      `${b.business} : votre ${b.service} du ${b.when} est annulé(e). Réf. ${b.reference}.`,
    reminder: (b) =>
      `Rappel de ${b.business} : votre ${b.service} est le ${b.when}. Réf. ${b.reference}.`,
    change: (p) => ` Pour le modifier, appelez le ${p}.`,
    subject: {
      created: (n) => `${n} : réservation confirmée`,
      moved: (n) => `${n} : réservation déplacée`,
      cancelled: (n) => `${n} : réservation annulée`,
      reminder: (n) => `${n} : rappel de rendez-vous`,
    },
  },
  de: {
    created: (b) =>
      `${b.business}: Ihr Termin (${b.service}) ist am ${b.when} gebucht. Ref. ${b.reference}.`,
    moved: (b) =>
      `${b.business}: Ihr Termin (${b.service}) wurde auf ${b.when} verlegt. Ref. ${b.reference}.`,
    cancelled: (b) =>
      `${b.business}: Ihr Termin (${b.service}) am ${b.when} ist storniert. Ref. ${b.reference}.`,
    reminder: (b) =>
      `Erinnerung von ${b.business}: Ihr Termin (${b.service}) ist am ${b.when}. Ref. ${b.reference}.`,
    change: (p) => ` Änderungen unter ${p}.`,
    subject: {
      created: (n) => `${n}: Termin bestätigt`,
      moved: (n) => `${n}: Termin verlegt`,
      cancelled: (n) => `${n}: Termin storniert`,
      reminder: (n) => `${n}: Terminerinnerung`,
    },
  },
  zh: {
    created: (b) => `${b.business}：您的${b.service}已预约在${b.when}。参考号 ${b.reference}。`,
    moved: (b) => `${b.business}：您的${b.service}已改到${b.when}。参考号 ${b.reference}。`,
    cancelled: (b) => `${b.business}：您${b.when}的${b.service}已取消。参考号 ${b.reference}。`,
    reminder: (b) => `${b.business}提醒：您的${b.service}在${b.when}。参考号 ${b.reference}。`,
    change: (p) => `如需更改，请致电 ${p}。`,
    subject: {
      created: (n) => `${n}：预约已确认`,
      moved: (n) => `${n}：预约已更改`,
      cancelled: (n) => `${n}：预约已取消`,
      reminder: (n) => `${n}：预约提醒`,
    },
  },
  ar: {
    created: (b) => `${b.business}: تم حجز ${b.service} في ${b.when}. المرجع ${b.reference}.`,
    moved: (b) => `${b.business}: تم نقل موعد ${b.service} إلى ${b.when}. المرجع ${b.reference}.`,
    cancelled: (b) => `${b.business}: تم إلغاء ${b.service} في ${b.when}. المرجع ${b.reference}.`,
    reminder: (b) =>
      `تذكير من ${b.business}: موعد ${b.service} في ${b.when}. المرجع ${b.reference}.`,
    change: (p) => ` للتغيير اتصل على ${p}.`,
    subject: {
      created: (n) => `${n}: تم تأكيد الحجز`,
      moved: (n) => `${n}: تم نقل الحجز`,
      cancelled: (n) => `${n}: تم إلغاء الحجز`,
      reminder: (n) => `${n}: تذكير بالموعد`,
    },
  },
};

const LOCALE: Record<Lang, string> = {
  en: "en-GB",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  zh: "zh-CN",
  ar: "ar",
};

export function formatWhen(date: Date, lang: Lang, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function customerBookingText(
  lang: Lang,
  change: BookingChange,
  b: BookingText,
): { subject: string; text: string } {
  const t = T[lang];
  const main = t[change](b);
  const tail = b.contactPhone && change !== "cancelled" ? t.change(b.contactPhone) : "";
  return { subject: t.subject[change](b.business), text: `${main}${tail}` };
}

export interface OutgoingMessage {
  channel: "sms" | "email";
  to: string;
  subject?: string;
  text: string;
  /** For logs and metrics. */
  kind: string;
}

export interface NotificationPlan {
  messages: OutgoingMessage[];
  /** Reminder job to (re)schedule or remove for a booking. */
  reminder?:
    | { action: "schedule"; bookingId: string; runAt: Date; startsAt: string; language: Lang }
    | { action: "remove"; bookingId: string };
}

async function loadBusiness(db: Database, tenantId: string) {
  const data = await withTenant(db, tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const [settings] = await tx
      .select()
      .from(agentSettings)
      .where(eq(agentSettings.tenantId, tenantId));
    const [number] = await tx
      .select({ e164: phoneNumbers.e164 })
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.status, "active")))
      .orderBy(asc(phoneNumbers.createdAt))
      .limit(1);
    return { tenant, settings, number };
  });
  const profile = await getApprovedProfile(db, tenantId);
  return {
    name: profile?.businessName || data.tenant?.name || "",
    timezone: data.tenant?.timezone ?? "Europe/London",
    // The number customers should call: the published one, else the assistant's line.
    contactPhone: profile?.contact.phone || data.number?.e164 || null,
    reminderHours: data.settings?.reminderHours ?? 24,
    confirmations: data.settings?.customerConfirmations ?? true,
    alertPhone: data.settings?.alertPhone ?? null,
    adminLanguage: toLang(data.settings?.adminLanguage, "en"),
  };
}

/** Confirmation (and reminder scheduling) for a booking that was made, moved or cancelled. */
export async function planBookingNotification(
  db: Database,
  job: { tenantId: string; bookingId: string; change: "created" | "moved" | "cancelled" },
  now: Date = new Date(),
): Promise<NotificationPlan> {
  const [booking] = await withTenant(db, job.tenantId, (tx) =>
    tx.select().from(bookings).where(eq(bookings.id, job.bookingId)),
  );
  if (!booking) return { messages: [] };
  const business = await loadBusiness(db, job.tenantId);
  const lang = await bookingLanguage(db, job.tenantId, booking.conversationId);
  const text = customerBookingText(lang, job.change, {
    business: business.name,
    service: booking.service,
    when: formatWhen(booking.startsAt, lang, business.timezone),
    reference: booking.reference,
    contactPhone: business.contactPhone,
  });
  const messages: OutgoingMessage[] = [];
  if (business.confirmations) {
    if (booking.customerPhone) {
      messages.push({
        channel: "sms",
        to: booking.customerPhone,
        text: text.text,
        kind: `booking.${job.change}`,
      });
    }
    if (booking.customerEmail) {
      messages.push({
        channel: "email",
        to: booking.customerEmail,
        subject: text.subject,
        text: text.text,
        kind: `booking.${job.change}`,
      });
    }
  }
  if (job.change === "cancelled")
    return { messages, reminder: { action: "remove", bookingId: booking.id } };
  const runAt = new Date(booking.startsAt.getTime() - business.reminderHours * 3600_000);
  const reminder: NotificationPlan["reminder"] =
    business.reminderHours > 0 && runAt > now
      ? {
          action: "schedule",
          bookingId: booking.id,
          runAt,
          startsAt: booking.startsAt.toISOString(),
          language: lang,
        }
      : { action: "remove", bookingId: booking.id };
  return { messages, reminder };
}

/** The reminder itself; skipped if the booking was cancelled or moved since it was scheduled. */
export async function planBookingReminder(
  db: Database,
  job: { tenantId: string; bookingId: string; startsAt: string },
): Promise<NotificationPlan> {
  const [booking] = await withTenant(db, job.tenantId, (tx) =>
    tx.select().from(bookings).where(eq(bookings.id, job.bookingId)),
  );
  if (
    !booking ||
    booking.status !== "confirmed" ||
    booking.startsAt.toISOString() !== job.startsAt
  ) {
    return { messages: [] };
  }
  const business = await loadBusiness(db, job.tenantId);
  if (business.reminderHours <= 0) return { messages: [] };
  const lang = await bookingLanguage(db, job.tenantId, booking.conversationId);
  const text = customerBookingText(lang, "reminder", {
    business: business.name,
    service: booking.service,
    when: formatWhen(booking.startsAt, lang, business.timezone),
    reference: booking.reference,
    contactPhone: business.contactPhone,
  });
  const messages: OutgoingMessage[] = [];
  if (booking.customerPhone) {
    messages.push({
      channel: "sms",
      to: booking.customerPhone,
      text: text.text,
      kind: "booking.reminder",
    });
  }
  if (booking.customerEmail) {
    messages.push({
      channel: "email",
      to: booking.customerEmail,
      subject: text.subject,
      text: text.text,
      kind: "booking.reminder",
    });
  }
  return { messages };
}

async function bookingLanguage(
  db: Database,
  tenantId: string,
  conversationId: string | null,
): Promise<Lang> {
  if (!conversationId) return "en";
  const [conv] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ language: conversations.language })
      .from(conversations)
      .where(eq(conversations.id, conversationId)),
  );
  return toLang(conv?.language, "en");
}

const ALERT: Record<
  Lang,
  {
    ticket: string;
    message: string;
    callback: string;
    open: string;
    transfer: string;
    withheld: string;
  }
> = {
  en: {
    ticket: "Urgent issue",
    message: "Urgent message",
    callback: "Call back",
    open: "Open",
    transfer: "Putting a caller through to you now",
    withheld: "number withheld",
  },
  es: {
    ticket: "Incidencia urgente",
    message: "Mensaje urgente",
    callback: "Devolver llamada",
    open: "Ver",
    transfer: "Le paso una llamada ahora",
    withheld: "número oculto",
  },
  fr: {
    ticket: "Problème urgent",
    message: "Message urgent",
    callback: "Rappeler",
    open: "Voir",
    transfer: "Je vous transfère un appel",
    withheld: "numéro masqué",
  },
  de: {
    ticket: "Dringendes Anliegen",
    message: "Dringende Nachricht",
    callback: "Rückruf",
    open: "Öffnen",
    transfer: "Ich stelle Ihnen jetzt einen Anruf durch",
    withheld: "Nummer unterdrückt",
  },
  zh: {
    ticket: "紧急问题",
    message: "紧急留言",
    callback: "回电",
    open: "查看",
    transfer: "正在为您转接一通来电",
    withheld: "隐藏号码",
  },
  ar: {
    ticket: "مشكلة عاجلة",
    message: "رسالة عاجلة",
    callback: "معاودة الاتصال",
    open: "فتح",
    transfer: "أحوّل إليك مكالمة الآن",
    withheld: "رقم محجوب",
  },
};

/** Heads-up text to the person a call is being transferred to: who and why. */
export async function planTransferContext(
  db: Database,
  job: { tenantId: string; conversationId: string; to: string; reason: string },
): Promise<NotificationPlan> {
  const business = await loadBusiness(db, job.tenantId);
  const l = ALERT[business.adminLanguage];
  const [conv] = await withTenant(db, job.tenantId, (tx) =>
    tx.select().from(conversations).where(eq(conversations.id, job.conversationId)),
  );
  const caller =
    (conv?.state as { callerPhone?: string | null } | undefined)?.callerPhone ?? l.withheld;
  return {
    messages: [
      {
        channel: "sms",
        to: job.to,
        text: `${business.name}: ${l.transfer}. ${caller}. ${job.reason}`.slice(0, 300),
        kind: "transfer.context",
      },
    ],
  };
}

/**
 * Immediate alert to the business's owners and admins (email) and optional on-call mobile
 * (SMS) about an urgent ticket, a callback request or an urgent message.
 */
export async function planStaffAlert(
  db: Database,
  job: { tenantId: string; record: "ticket" | "message"; id: string },
  webOrigin: string,
): Promise<NotificationPlan> {
  const business = await loadBusiness(db, job.tenantId);
  const l = ALERT[business.adminLanguage];
  let line = null as string | null;
  await withTenant(db, job.tenantId, async (tx) => {
    if (job.record === "ticket") {
      const [t] = await tx.select().from(tickets).where(eq(tickets.id, job.id));
      if (!t) return;
      const name = (t.details as { callerName?: string } | null)?.callerName ?? "";
      line = [
        `${l.ticket} ${t.reference}`,
        [name, t.callbackPhone].filter(Boolean).join(" "),
        t.summary ?? "",
        t.callbackTime ? `${l.callback}: ${t.callbackTime}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    } else {
      const [m] = await tx.select().from(staffMessages).where(eq(staffMessages.id, job.id));
      if (!m) return;
      line = [
        `${l.message} ${m.reference}`,
        `${m.callerName} ${m.callerPhone}`,
        m.reason,
        m.bestTime ? `${l.callback}: ${m.bestTime}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    }
  });
  if (!line) return { messages: [] };
  const link = `${webOrigin}/t/${job.tenantId}/records`;
  const recipients = await db
    .select({ email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, job.tenantId), inArray(member.role, ["owner", "admin"])));
  const messages: OutgoingMessage[] = recipients.map((r) => ({
    channel: "email",
    to: r.email,
    subject: `⚠ ${business.name}: ${line!.split(" · ")[0]}`,
    text: `${line!.replaceAll(" · ", "\n")}\n\n${l.open}: ${link}`,
    kind: "staff.alert",
  }));
  if (business.alertPhone) {
    messages.push({
      channel: "sms",
      to: business.alertPhone,
      text: `${business.name}: ${line}`.slice(0, 300),
      kind: "staff.alert",
    });
  }
  return { messages };
}
