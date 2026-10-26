import {
  agentSettings,
  bookings,
  conversations,
  feedback,
  followUps,
  member,
  organization,
  staffMessages,
  tenants,
  user,
  withTenant,
  type Database,
} from "@voicedesk/db";
import { and, eq, gte, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { localDateString, zonedToUtc } from "./availability";
import { feedbackStats } from "./feedback";
import { toLang, type Lang } from "./languages";
import { getApprovedProfile } from "./profile-store";
import { isOpenNow } from "./transfer";

/**
 * Monthly value report (ADR 0028): what the assistant did for the business last month, so the
 * owner sees the value. Built from the data: no AI, no cost, every plan.
 */

/** Local time on the 1st when the report goes out (up to the 3rd if the worker was down). */
export const VALUE_REPORT_TIME = "08:00";
const LAST_SEND_DAY = 3;

export interface ValueNumbers {
  /** "YYYY-MM" of the month covered. */
  month: string;
  conversations: number;
  calls: number;
  chats: number;
  /** Calls outside the approved opening hours; null when the hours aren't known. */
  outOfHours: number | null;
  /** Calls the team missed (forwarded or backup line) that the assistant took. */
  missedSaved: number;
  assistantBookings: number;
  followUpBookings: number;
  messages: number;
  callMinutes: number;
  csat: number | null;
  ratings: number;
  /** assistantBookings × the business's average booking value; null when that isn't set. */
  estimatedValuePence: number | null;
  averageBookingPence: number | null;
}

/** "YYYY-MM" → the first day of that month and of the next ("YYYY-MM-DD"). */
function monthBounds(month: string): { first: string; next: string } {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, "0")}`;
  return { first: `${month}-01`, next: `${next}-01` };
}

/** The month before "YYYY-MM". */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;
}

/** The numbers for one calendar month in the business's time zone (to `until` if sooner). */
export async function valueNumbers(
  db: Database,
  tenantId: string,
  timezone: string,
  month: string,
  until?: Date,
): Promise<ValueNumbers> {
  const { first, next } = monthBounds(month);
  const start = zonedToUtc(first, "00:00", timezone);
  const monthEnd = zonedToUtc(next, "00:00", timezone);
  const end = until && until < monthEnd ? until : monthEnd;
  const within = (col: Parameters<typeof gte>[0]) => and(gte(col, start), lt(col, end));
  const count = sql<number>`count(*)::int`;
  const profile = await getApprovedProfile(db, tenantId);
  const hoursKnown = Boolean(profile?.openingHours.some((h) => h.open && h.close));

  return withTenant(db, tenantId, async (tx) => {
    const real = and(
      eq(conversations.tenantId, tenantId),
      ne(conversations.channel, "test_console"),
      within(conversations.startedAt),
    );
    const [conv] = await tx
      .select({
        all: count,
        calls: sql<number>`count(*) filter (where ${conversations.channel} = 'voice')::int`,
        chats: sql<number>`count(*) filter (where ${conversations.channel} in ('web_chat','whatsapp','email','web_form'))::int`,
        missedSaved: sql<number>`count(*) filter (where ${conversations.channel} = 'voice' and ${conversations.entry} <> 'direct')::int`,
        callSeconds: sql<number>`coalesce(sum(extract(epoch from (${conversations.endedAt} - ${conversations.startedAt}))) filter (where ${conversations.channel} = 'voice' and ${conversations.endedAt} is not null), 0)::float`,
      })
      .from(conversations)
      .where(real);
    const callStarts = hoursKnown
      ? await tx
          .select({ at: conversations.startedAt })
          .from(conversations)
          .where(and(real, eq(conversations.channel, "voice")))
      : [];
    const [made] = await tx
      .select({ n: count })
      .from(bookings)
      .innerJoin(conversations, eq(conversations.id, bookings.conversationId))
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          ne(conversations.channel, "test_console"),
          within(bookings.createdAt),
        ),
      );
    const [won] = await tx
      .select({ n: count })
      .from(followUps)
      .innerJoin(bookings, eq(bookings.id, followUps.bookingId))
      .where(
        and(
          eq(followUps.tenantId, tenantId),
          isNotNull(followUps.bookingId),
          within(bookings.createdAt),
        ),
      );
    const [taken] = await tx
      .select({ n: count })
      .from(staffMessages)
      .where(and(eq(staffMessages.tenantId, tenantId), within(staffMessages.createdAt)));
    const ratings = await tx
      .select({ kind: feedback.kind, score: feedback.score })
      .from(feedback)
      .where(and(eq(feedback.tenantId, tenantId), within(feedback.sentAt)));
    const [settings] = await tx
      .select({ average: agentSettings.averageBookingPence })
      .from(agentSettings)
      .where(eq(agentSettings.tenantId, tenantId));

    const stats = feedbackStats(ratings);
    const assistantBookings = made?.n ?? 0;
    const average = settings?.average ?? null;
    return {
      month,
      conversations: conv?.all ?? 0,
      calls: conv?.calls ?? 0,
      chats: conv?.chats ?? 0,
      outOfHours: hoursKnown
        ? callStarts.filter((c) => !isOpenNow(profile, timezone, c.at)).length
        : null,
      missedSaved: conv?.missedSaved ?? 0,
      assistantBookings,
      followUpBookings: won?.n ?? 0,
      messages: taken?.n ?? 0,
      callMinutes: Math.round((conv?.callSeconds ?? 0) / 60),
      csat: stats.csat,
      ratings: stats.answered,
      estimatedValuePence: average === null ? null : assistantBookings * average,
      averageBookingPence: average,
    };
  });
}

interface Labels {
  subject: (business: string, month: string) => string;
  intro: (business: string, month: string) => string;
  conversations: (n: number, calls: number, chats: number) => string;
  outOfHours: string;
  missedSaved: string;
  bookings: string;
  followUps: string;
  messages: string;
  callMinutes: (n: number) => string;
  rating: (pct: number, n: number) => string;
  value: (value: string, n: number, average: string) => string;
  setAverage: string;
  quiet: string;
  open: string;
}

const LABELS: Record<Lang, Labels> = {
  en: {
    subject: (b, m) => `${b}: what your assistant did in ${m}`,
    intro: (b, m) => `Here's what your AI assistant handled for ${b} in ${m}.`,
    conversations: (n, c, ch) =>
      `Conversations handled: ${n} (${c} calls, ${ch} chats and messages)`,
    outOfHours: "Calls answered while you were closed",
    missedSaved: "Missed calls the assistant picked up",
    bookings: "Bookings made by the assistant",
    followUps: "Bookings won back by follow-ups",
    messages: "Messages taken for you",
    callMinutes: (n) => `Time on the phone for you: ${n} minutes`,
    rating: (p, n) => `Satisfied customers: ${p}% (${n} ratings)`,
    value: (v, n, a) => `Estimated value of those bookings: ${v} (${n} × your average of ${a})`,
    setAverage:
      "Tip: add your average booking value under Assistant settings → Reports to see what these bookings were worth.",
    quiet: "A quiet month: share your number and website chat to get more from your assistant.",
    open: "Open VoiceDesk",
  },
  es: {
    subject: (b, m) => `${b}: lo que hizo su asistente en ${m}`,
    intro: (b, m) => `Esto es lo que su asistente de IA gestionó para ${b} en ${m}.`,
    conversations: (n, c, ch) =>
      `Conversaciones atendidas: ${n} (${c} llamadas, ${ch} chats y mensajes)`,
    outOfHours: "Llamadas atendidas con el negocio cerrado",
    missedSaved: "Llamadas perdidas que atendió el asistente",
    bookings: "Reservas hechas por el asistente",
    followUps: "Reservas recuperadas con seguimientos",
    messages: "Mensajes recogidos para usted",
    callMinutes: (n) => `Tiempo al teléfono por usted: ${n} minutos`,
    rating: (p, n) => `Clientes satisfechos: ${p}% (${n} valoraciones)`,
    value: (v, n, a) => `Valor estimado de esas reservas: ${v} (${n} × su media de ${a})`,
    setAverage:
      "Consejo: indique el valor medio de una reserva en Ajustes del asistente → Informes para ver cuánto valían.",
    quiet:
      "Un mes tranquilo: comparta su número y el chat web para sacar más partido al asistente.",
    open: "Abrir VoiceDesk",
  },
  fr: {
    subject: (b, m) => `${b} : ce que votre assistant a fait en ${m}`,
    intro: (b, m) => `Voici ce que votre assistant IA a géré pour ${b} en ${m}.`,
    conversations: (n, c, ch) =>
      `Conversations traitées : ${n} (${c} appels, ${ch} chats et messages)`,
    outOfHours: "Appels pris pendant vos heures de fermeture",
    missedSaved: "Appels manqués pris par l'assistant",
    bookings: "Réservations faites par l'assistant",
    followUps: "Réservations obtenues grâce aux relances",
    messages: "Messages pris pour vous",
    callMinutes: (n) => `Temps au téléphone à votre place : ${n} minutes`,
    rating: (p, n) => `Clients satisfaits : ${p} % (${n} avis)`,
    value: (v, n, a) => `Valeur estimée de ces réservations : ${v} (${n} × votre moyenne de ${a})`,
    setAverage:
      "Astuce : indiquez la valeur moyenne d'une réservation dans Réglages de l'assistant → Rapports pour voir ce qu'elles valaient.",
    quiet:
      "Un mois calme : partagez votre numéro et le chat du site pour tirer plus de votre assistant.",
    open: "Ouvrir VoiceDesk",
  },
  de: {
    subject: (b, m) => `${b}: Was Ihr Assistent im ${m} erledigt hat`,
    intro: (b, m) => `Das hat Ihr KI-Assistent im ${m} für ${b} erledigt.`,
    conversations: (n, c, ch) =>
      `Bearbeitete Gespräche: ${n} (${c} Anrufe, ${ch} Chats und Nachrichten)`,
    outOfHours: "Anrufe außerhalb Ihrer Öffnungszeiten",
    missedSaved: "Verpasste Anrufe, die der Assistent übernommen hat",
    bookings: "Buchungen durch den Assistenten",
    followUps: "Buchungen durch Nachfassen gewonnen",
    messages: "Für Sie aufgenommene Nachrichten",
    callMinutes: (n) => `Zeit am Telefon für Sie: ${n} Minuten`,
    rating: (p, n) => `Zufriedene Kunden: ${p} % (${n} Bewertungen)`,
    value: (v, n, a) =>
      `Geschätzter Wert dieser Buchungen: ${v} (${n} × Ihr Durchschnitt von ${a})`,
    setAverage:
      "Tipp: Tragen Sie unter Assistenten-Einstellungen → Berichte Ihren durchschnittlichen Buchungswert ein, um den Wert zu sehen.",
    quiet:
      "Ein ruhiger Monat: Teilen Sie Ihre Nummer und den Website-Chat, um mehr aus Ihrem Assistenten zu holen.",
    open: "VoiceDesk öffnen",
  },
  zh: {
    subject: (b, m) => `${b}：${m}助理工作报告`,
    intro: (b, m) => `以下是您的 AI 助理在${m}为${b}处理的工作。`,
    conversations: (n, c, ch) => `处理的对话：${n}（来电 ${c}，聊天和留言 ${ch}）`,
    outOfHours: "非营业时间接听的来电",
    missedSaved: "助理接起的未接来电",
    bookings: "助理完成的预约",
    followUps: "通过跟进挽回的预约",
    messages: "为您记录的留言",
    callMinutes: (n) => `代您通话时长：${n} 分钟`,
    rating: (p, n) => `满意客户：${p}%（${n} 个评分）`,
    value: (v, n, a) => `这些预约的估计价值：${v}（${n} × 平均 ${a}）`,
    setAverage: "提示：在“助理设置 → 报告”中填写平均预约金额，即可看到这些预约的价值。",
    quiet: "本月较为清淡：分享您的电话号码和网站聊天，让助理发挥更大作用。",
    open: "打开 VoiceDesk",
  },
  ar: {
    subject: (b, m) => `${b}: ما أنجزه مساعدك في ${m}`,
    intro: (b, m) => `إليك ما تولاه مساعدك الذكي لـ ${b} في ${m}.`,
    conversations: (n, c, ch) => `المحادثات المنجزة: ${n} (${c} مكالمات، ${ch} دردشة ورسالة)`,
    outOfHours: "مكالمات أُجيب عنها خارج ساعات العمل",
    missedSaved: "مكالمات فائتة تولاها المساعد",
    bookings: "حجوزات أجراها المساعد",
    followUps: "حجوزات استُعيدت بالمتابعة",
    messages: "رسائل سُجلت لك",
    callMinutes: (n) => `وقت على الهاتف نيابةً عنك: ${n} دقيقة`,
    rating: (p, n) => `العملاء الراضون: ${p}% (${n} تقييمات)`,
    value: (v, n, a) => `القيمة التقديرية لهذه الحجوزات: ${v} (${n} × متوسطك ${a})`,
    setAverage: "نصيحة: أضف متوسط قيمة الحجز في إعدادات المساعد ← التقارير لترى قيمة هذه الحجوزات.",
    quiet: "شهر هادئ: شارك رقمك ودردشة موقعك لتستفيد أكثر من مساعدك.",
    open: "فتح VoiceDesk",
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

/** "2026-10" → "October 2026" in the report's language. */
export function monthName(month: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-15T12:00:00Z`));
}

function money(pence: number, lang: Lang, currency: string): string {
  return new Intl.NumberFormat(LOCALE[lang], {
    style: "currency",
    currency,
    maximumFractionDigits: pence % 100 === 0 ? 0 : 2,
  }).format(pence / 100);
}

/** The email text (pure, so the wording is tested on its own). */
export function renderValueReport(
  n: ValueNumbers,
  params: { lang: Lang; business: string; link: string; currency?: string },
): { subject: string; text: string } {
  const l = LABELS[params.lang];
  const currency = params.currency ?? "GBP";
  const month = monthName(n.month, params.lang);
  const lines = [l.intro(params.business, month), ""];
  lines.push(`- ${l.conversations(n.conversations, n.calls, n.chats)}`);
  if (n.outOfHours) lines.push(`- ${l.outOfHours}: ${n.outOfHours}`);
  if (n.missedSaved) lines.push(`- ${l.missedSaved}: ${n.missedSaved}`);
  lines.push(`- ${l.bookings}: ${n.assistantBookings}`);
  if (n.followUpBookings) lines.push(`- ${l.followUps}: ${n.followUpBookings}`);
  lines.push(`- ${l.messages}: ${n.messages}`);
  if (n.callMinutes) lines.push(`- ${l.callMinutes(n.callMinutes)}`);
  if (n.csat !== null) lines.push(`- ${l.rating(n.csat, n.ratings)}`);
  lines.push("");
  if (n.estimatedValuePence !== null && n.averageBookingPence !== null) {
    if (n.assistantBookings > 0) {
      lines.push(
        l.value(
          money(n.estimatedValuePence, params.lang, currency),
          n.assistantBookings,
          money(n.averageBookingPence, params.lang, currency),
        ),
      );
    }
  } else if (n.assistantBookings > 0) {
    lines.push(l.setAverage);
  }
  if (n.conversations < 5) lines.push(l.quiet);
  lines.push("", `${l.open}: ${params.link}`);
  return {
    subject: l.subject(params.business, month),
    text: lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };
}

/** Last month's report for one business, addressed to its owners and admins. */
export async function prepareValueReport(
  db: Database,
  tenantId: string,
  now: Date,
  webOrigin: string,
  options: { period?: "this_month" | "last_month" } = {},
): Promise<{
  month: string;
  numbers: ValueNumbers;
  subject: string;
  text: string;
  to: string[];
} | null> {
  const [data] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ tenant: tenants, settings: agentSettings })
      .from(tenants)
      .leftJoin(agentSettings, eq(agentSettings.tenantId, tenants.id))
      .where(eq(tenants.id, tenantId)),
  );
  if (!data) return null;
  const timezone = data.tenant.timezone;
  const current = localDateString(now, timezone).slice(0, 7);
  const month = options.period === "this_month" ? current : previousMonth(current);
  const numbers = await valueNumbers(db, tenantId, timezone, month, now);
  const report = renderValueReport(numbers, {
    lang: toLang(data.settings?.adminLanguage, "en"),
    business: data.tenant.name,
    link: `${webOrigin}/t/${tenantId}`,
  });
  const recipients = await db
    .select({ email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, tenantId), inArray(member.role, ["owner", "admin"])));
  return { month, numbers, ...report, to: recipients.map((r) => r.email) };
}

/**
 * Businesses whose report for last month is due: the 1st–3rd after 08:00 local time,
 * switched on, not yet sent for that month. Marks each (so it's sent once) and returns them.
 */
export async function claimDueValueReports(
  db: Database,
  now: Date,
  /** Limit to these businesses (tests); by default every business. */
  only?: string[],
): Promise<string[]> {
  // The auth table lists every business without crossing tenants under RLS.
  const all = await db
    .select({ id: organization.id })
    .from(organization)
    .where(only ? inArray(organization.id, only) : undefined);
  const due: string[] = [];
  for (const { id } of all) {
    const claimed = await withTenant(db, id, async (tx) => {
      const [tenant] = await tx
        .select({ timezone: tenants.timezone })
        .from(tenants)
        .where(eq(tenants.id, id));
      if (!tenant) return false;
      const today = localDateString(now, tenant.timezone);
      if (Number(today.slice(8, 10)) > LAST_SEND_DAY) return false;
      const local = new Intl.DateTimeFormat("en-GB", {
        timeZone: tenant.timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(now);
      if (local < VALUE_REPORT_TIME) return false;
      const month = previousMonth(today.slice(0, 7));
      await tx.insert(agentSettings).values({ tenantId: id }).onConflictDoNothing();
      const rows = await tx
        .update(agentSettings)
        .set({ valueReportSentFor: month })
        .where(
          and(
            eq(agentSettings.tenantId, id),
            eq(agentSettings.valueReport, true),
            sql`${agentSettings.valueReportSentFor} is distinct from ${month}`,
          ),
        )
        .returning({ tenantId: agentSettings.tenantId });
      return rows.length > 0;
    });
    if (claimed) due.push(id);
  }
  return due;
}
