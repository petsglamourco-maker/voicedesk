import { getPlanState, planAllows } from "@voicedesk/core";
import {
  agentSettings,
  bookings,
  channelThreads,
  conversationMessages,
  gapAnswers,
  conversations,
  feedback,
  handoffs,
  knowledgeGaps,
  member,
  organization,
  staffMessages,
  tenants,
  tickets,
  user,
  withTenant,
  type Database,
} from "@voicedesk/db";
import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { localDateString, zonedToUtc } from "./availability";
import { feedbackStats } from "./feedback";
import { toLang, type Lang } from "./languages";

/**
 * Daily brief (Phase 6, ADR 0020): one morning email to owners and admins with yesterday at
 * a glance, today's bookings and what needs them. Built from the data: no AI, no cost.
 */

/** Local time the brief goes out. */
export const BRIEF_TIME = "07:30";

interface Labels {
  subject: (business: string, date: string) => string;
  yesterday: string;
  calls: string;
  chats: string;
  bookingsMade: string;
  cancelled: string;
  tickets: string;
  messages: string;
  missedHandoffs: string;
  /** ADR 0025: calls the team missed (forwarded / backup) that the assistant took. */
  missedByTeam: string;
  unanswered: string;
  rating: (pct: number, n: number) => string;
  today: string;
  noBookings: string;
  needsYou: string;
  /** ADR 0026: Monday list of grouped unanswered questions. */
  questions: string;
  openTickets: string;
  waiting: string;
  drafts: string;
  allClear: string;
  open: string;
}

const LABELS: Record<Lang, Labels> = {
  en: {
    subject: (b, d) => `${b}: your daily brief for ${d}`,
    yesterday: "Yesterday",
    calls: "Calls",
    chats: "Chats, WhatsApp, email and forms",
    bookingsMade: "Bookings made",
    cancelled: "Cancelled",
    tickets: "New tickets",
    messages: "New messages",
    missedHandoffs: "Callers nobody could take",
    missedByTeam: "Missed calls the assistant handled",
    unanswered: "Questions the assistant couldn't answer",
    rating: (p, n) => `Satisfied customers: ${p}% (${n} ratings)`,
    today: "Today",
    noBookings: "No bookings today.",
    needsYou: "Needs you",
    openTickets: "Open tickets",
    waiting: "Conversations waiting for a person",
    drafts: "Email replies waiting for approval",
    questions: "Questions your assistant couldn't answer (approve answers under Knowledge)",
    allClear: "Nothing waiting. Have a good day!",
    open: "Open VoiceDesk",
  },
  es: {
    subject: (b, d) => `${b}: su resumen diario del ${d}`,
    yesterday: "Ayer",
    calls: "Llamadas",
    chats: "Chats, WhatsApp, correo y formularios",
    bookingsMade: "Reservas hechas",
    cancelled: "Canceladas",
    tickets: "Incidencias nuevas",
    messages: "Mensajes nuevos",
    missedHandoffs: "Llamadas que nadie pudo atender",
    missedByTeam: "Llamadas perdidas atendidas por el asistente",
    unanswered: "Preguntas sin respuesta del asistente",
    rating: (p, n) => `Clientes satisfechos: ${p}% (${n} valoraciones)`,
    today: "Hoy",
    noBookings: "Hoy no hay reservas.",
    needsYou: "Pendiente",
    openTickets: "Incidencias abiertas",
    waiting: "Conversaciones esperando a una persona",
    drafts: "Respuestas por correo pendientes de aprobar",
    questions: "Preguntas que su asistente no supo responder (apruebe respuestas en Conocimiento)",
    allClear: "Nada pendiente. ¡Que tenga un buen día!",
    open: "Abrir VoiceDesk",
  },
  fr: {
    subject: (b, d) => `${b} : votre résumé du ${d}`,
    yesterday: "Hier",
    calls: "Appels",
    chats: "Chats, WhatsApp, e-mails et formulaires",
    bookingsMade: "Réservations",
    cancelled: "Annulées",
    tickets: "Nouveaux tickets",
    messages: "Nouveaux messages",
    missedHandoffs: "Appels que personne n'a pu prendre",
    missedByTeam: "Appels manqués pris en charge par l'assistant",
    unanswered: "Questions restées sans réponse",
    rating: (p, n) => `Clients satisfaits : ${p} % (${n} avis)`,
    today: "Aujourd'hui",
    noBookings: "Aucune réservation aujourd'hui.",
    needsYou: "À traiter",
    openTickets: "Tickets ouverts",
    waiting: "Conversations en attente d'une personne",
    drafts: "Réponses e-mail à valider",
    questions:
      "Questions sans réponse de votre assistant (validez les réponses dans Connaissances)",
    allClear: "Rien en attente. Bonne journée !",
    open: "Ouvrir VoiceDesk",
  },
  de: {
    subject: (b, d) => `${b}: Ihr Tagesüberblick für ${d}`,
    yesterday: "Gestern",
    calls: "Anrufe",
    chats: "Chats, WhatsApp, E-Mails und Formulare",
    bookingsMade: "Neue Buchungen",
    cancelled: "Storniert",
    tickets: "Neue Tickets",
    messages: "Neue Nachrichten",
    missedHandoffs: "Anrufer, die niemand übernehmen konnte",
    missedByTeam: "Verpasste Anrufe, die der Assistent übernommen hat",
    unanswered: "Fragen, die die Assistenz nicht beantworten konnte",
    rating: (p, n) => `Zufriedene Kunden: ${p} % (${n} Bewertungen)`,
    today: "Heute",
    noBookings: "Heute keine Buchungen.",
    needsYou: "Für Sie zu erledigen",
    openTickets: "Offene Tickets",
    waiting: "Gespräche, die auf eine Person warten",
    drafts: "E-Mail-Antworten zur Freigabe",
    questions:
      "Fragen, die Ihr Assistent nicht beantworten konnte (Antworten unter Wissen freigeben)",
    allClear: "Nichts offen. Einen schönen Tag!",
    open: "VoiceDesk öffnen",
  },
  zh: {
    subject: (b, d) => `${b}：${d} 每日简报`,
    yesterday: "昨天",
    calls: "来电",
    chats: "聊天、WhatsApp、邮件和表单",
    bookingsMade: "新预约",
    cancelled: "已取消",
    tickets: "新工单",
    messages: "新留言",
    missedHandoffs: "无人接听的转人工来电",
    missedByTeam: "助理处理的未接来电",
    unanswered: "助理未能回答的问题",
    rating: (p, n) => `满意客户：${p}%（${n} 个评分）`,
    today: "今天",
    noBookings: "今天没有预约。",
    needsYou: "待您处理",
    openTickets: "未关闭工单",
    waiting: "等待人工回复的对话",
    drafts: "待批准的邮件回复",
    questions: "助理未能回答的问题（请在知识库中批准答案）",
    allClear: "没有待办事项，祝您愉快！",
    open: "打开 VoiceDesk",
  },
  ar: {
    subject: (b, d) => `${b}: ملخصك اليومي ليوم ${d}`,
    yesterday: "أمس",
    calls: "المكالمات",
    chats: "الدردشة وواتساب والبريد والنماذج",
    bookingsMade: "حجوزات جديدة",
    cancelled: "ملغاة",
    tickets: "تذاكر جديدة",
    messages: "رسائل جديدة",
    missedHandoffs: "متصلون لم يتمكن أحد من الرد عليهم",
    missedByTeam: "مكالمات فائتة تولاها المساعد",
    unanswered: "أسئلة لم يجب عنها المساعد",
    rating: (p, n) => `العملاء الراضون: ${p}% (${n} تقييمات)`,
    today: "اليوم",
    noBookings: "لا توجد حجوزات اليوم.",
    needsYou: "بانتظارك",
    openTickets: "تذاكر مفتوحة",
    waiting: "محادثات تنتظر شخصًا",
    drafts: "ردود بريد بانتظار الموافقة",
    questions: "أسئلة لم يستطع مساعدك الإجابة عنها (وافق على الإجابات في المعرفة)",
    allClear: "لا شيء بانتظارك. يومًا سعيدًا!",
    open: "فتح VoiceDesk",
  },
};

export interface BriefNumbers {
  calls: number;
  chats: number;
  bookingsMade: number;
  cancelled: number;
  tickets: number;
  messages: number;
  missedHandoffs: number;
  missedByTeam: number;
  unanswered: number;
  csat: number | null;
  ratings: number;
  today: Array<{ time: string; service: string; customer: string }>;
  /** Mondays only (ADR 0026): the most-asked questions waiting for an approved answer. */
  questions?: Array<{ question: string; count: number }>;
  openTickets: number;
  waiting: number;
  drafts: number;
}

/** "YYYY-MM-DD" ± days (calendar arithmetic, no time zones involved). */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The numbers for the business's local "yesterday" and "today" around `now`. */
export async function briefNumbers(
  db: Database,
  tenantId: string,
  timezone: string,
  now: Date,
): Promise<BriefNumbers> {
  const today = localDateString(now, timezone);
  const yStart = zonedToUtc(shiftDate(today, -1), "00:00", timezone);
  const tStart = zonedToUtc(today, "00:00", timezone);
  const tEnd = zonedToUtc(shiftDate(today, 1), "00:00", timezone);
  const yesterday = (col: Parameters<typeof gte>[0]) => and(gte(col, yStart), lt(col, tStart));
  const count = sql<number>`count(*)::int`;

  return withTenant(db, tenantId, async (tx) => {
    const [conv] = await tx
      .select({
        calls: sql<number>`count(*) filter (where ${conversations.channel} = 'voice')::int`,
        missedByTeam: sql<number>`count(*) filter (where ${conversations.channel} = 'voice' and ${conversations.entry} <> 'direct')::int`,
        chats: sql<number>`count(*) filter (where ${conversations.channel} in ('web_chat','whatsapp','email','web_form'))::int`,
      })
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), yesterday(conversations.startedAt)));
    const [made] = await tx
      .select({ n: count })
      .from(bookings)
      .where(and(eq(bookings.tenantId, tenantId), yesterday(bookings.createdAt)));
    const [cancelled] = await tx
      .select({ n: count })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.status, "cancelled"),
          yesterday(bookings.updatedAt),
        ),
      );
    const [newTickets] = await tx
      .select({ n: count })
      .from(tickets)
      .where(and(eq(tickets.tenantId, tenantId), yesterday(tickets.createdAt)));
    const [newMessages] = await tx
      .select({ n: count })
      .from(staffMessages)
      .where(and(eq(staffMessages.tenantId, tenantId), yesterday(staffMessages.createdAt)));
    const [missed] = await tx
      .select({ n: count })
      .from(handoffs)
      .where(
        and(
          eq(handoffs.tenantId, tenantId),
          eq(handoffs.status, "missed"),
          yesterday(handoffs.queuedAt),
        ),
      );
    const [gaps] = await tx
      .select({ n: count })
      .from(knowledgeGaps)
      .where(and(eq(knowledgeGaps.tenantId, tenantId), yesterday(knowledgeGaps.createdAt)));
    const ratings = await tx
      .select({ kind: feedback.kind, score: feedback.score })
      .from(feedback)
      .where(and(eq(feedback.tenantId, tenantId), yesterday(feedback.sentAt)));
    const todays = await tx
      .select({
        startsAt: bookings.startsAt,
        service: bookings.service,
        customer: bookings.customerName,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          ne(bookings.status, "cancelled"),
          gte(bookings.startsAt, tStart),
          lt(bookings.startsAt, tEnd),
        ),
      )
      .orderBy(asc(bookings.startsAt));
    const [openTickets] = await tx
      .select({ n: count })
      .from(tickets)
      .where(and(eq(tickets.tenantId, tenantId), inArray(tickets.status, ["open", "in_progress"])));
    const [waiting] = await tx
      .select({ n: count })
      .from(channelThreads)
      .where(and(eq(channelThreads.tenantId, tenantId), eq(channelThreads.needsHuman, true)));
    const [drafts] = await tx
      .select({ n: count })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.tenantId, tenantId),
          sql`${conversationMessages.metadata}->>'draft' = 'true'`,
        ),
      );
    const monday = new Date(`${today}T12:00:00Z`).getUTCDay() === 1;
    const questions = monday
      ? await tx
          .select({ question: gapAnswers.question, count: gapAnswers.count })
          .from(gapAnswers)
          .where(and(eq(gapAnswers.tenantId, tenantId), eq(gapAnswers.status, "pending")))
          .orderBy(desc(gapAnswers.count))
          .limit(3)
      : [];
    const stats = feedbackStats(ratings);
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    return {
      calls: conv?.calls ?? 0,
      chats: conv?.chats ?? 0,
      bookingsMade: made?.n ?? 0,
      cancelled: cancelled?.n ?? 0,
      tickets: newTickets?.n ?? 0,
      messages: newMessages?.n ?? 0,
      missedHandoffs: missed?.n ?? 0,
      missedByTeam: conv?.missedByTeam ?? 0,
      unanswered: gaps?.n ?? 0,
      csat: stats.csat,
      ratings: stats.answered,
      today: todays.map((b) => ({
        time: time.format(b.startsAt),
        service: b.service,
        customer: b.customer,
      })),
      openTickets: openTickets?.n ?? 0,
      waiting: waiting?.n ?? 0,
      drafts: drafts?.n ?? 0,
      ...(questions.length ? { questions } : {}),
    };
  });
}

/** The email text (pure, so the wording is tested on its own). */
export function renderBrief(
  n: BriefNumbers,
  params: { lang: Lang; business: string; date: string; link: string },
): { subject: string; text: string } {
  const l = LABELS[params.lang];
  const lines = [
    `${l.yesterday}`,
    `- ${l.calls}: ${n.calls}`,
    `- ${l.chats}: ${n.chats}`,
    `- ${l.bookingsMade}: ${n.bookingsMade}${n.cancelled ? ` (${l.cancelled}: ${n.cancelled})` : ""}`,
    `- ${l.tickets}: ${n.tickets}`,
    `- ${l.messages}: ${n.messages}`,
  ];
  if (n.missedByTeam) lines.push(`- ${l.missedByTeam}: ${n.missedByTeam}`);
  if (n.missedHandoffs) lines.push(`- ${l.missedHandoffs}: ${n.missedHandoffs}`);
  if (n.unanswered) lines.push(`- ${l.unanswered}: ${n.unanswered}`);
  if (n.csat !== null) lines.push(`- ${l.rating(n.csat, n.ratings)}`);
  lines.push("", l.today);
  if (n.today.length === 0) lines.push(l.noBookings);
  for (const b of n.today) lines.push(`- ${b.time} ${b.service} · ${b.customer}`);
  lines.push("", l.needsYou);
  const needs = [
    n.openTickets ? `- ${l.openTickets}: ${n.openTickets}` : null,
    n.waiting ? `- ${l.waiting}: ${n.waiting}` : null,
    n.drafts ? `- ${l.drafts}: ${n.drafts}` : null,
  ].filter((x): x is string => x !== null);
  if (n.questions?.length) {
    needs.push(
      `- ${l.questions}:`,
      ...n.questions.map((q) => `  · "${q.question.slice(0, 120)}" (×${q.count})`),
    );
  }
  lines.push(...(needs.length ? needs : [l.allClear]));
  lines.push("", `${l.open}: ${params.link}`);
  return { subject: l.subject(params.business, params.date), text: lines.join("\n") };
}

/** The brief for one business, addressed to its owners and admins. */
export async function prepareDailyBrief(
  db: Database,
  tenantId: string,
  now: Date,
  webOrigin: string,
): Promise<{ date: string; subject: string; text: string; to: string[] } | null> {
  const [data] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ tenant: tenants, settings: agentSettings })
      .from(tenants)
      .leftJoin(agentSettings, eq(agentSettings.tenantId, tenants.id))
      .where(eq(tenants.id, tenantId)),
  );
  if (!data) return null;
  const timezone = data.tenant.timezone;
  const numbers = await briefNumbers(db, tenantId, timezone, now);
  const date = localDateString(now, timezone);
  const brief = renderBrief(numbers, {
    lang: toLang(data.settings?.adminLanguage, "en"),
    business: data.tenant.name,
    date,
    link: `${webOrigin}/t/${tenantId}`,
  });
  const recipients = await db
    .select({ email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, tenantId), inArray(member.role, ["owner", "admin"])));
  return { date, ...brief, to: recipients.map((r) => r.email) };
}

/**
 * Businesses whose brief is due: past 07:30 local time, switched on, not yet sent today.
 * Marks each as sent (so a crash or two workers can't send it twice) and returns them.
 */
export async function claimDueBriefs(
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
    // The daily brief is a plan feature (ADR 0023).
    if (!planAllows(await getPlanState(db, id, now), "daily_brief")) continue;
    const claimed = await withTenant(db, id, async (tx) => {
      const [tenant] = await tx
        .select({ timezone: tenants.timezone })
        .from(tenants)
        .where(eq(tenants.id, id));
      if (!tenant) return false;
      const today = localDateString(now, tenant.timezone);
      const local = new Intl.DateTimeFormat("en-GB", {
        timeZone: tenant.timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(now);
      if (local < BRIEF_TIME) return false;
      await tx.insert(agentSettings).values({ tenantId: id }).onConflictDoNothing();
      const rows = await tx
        .update(agentSettings)
        .set({ briefSentOn: today })
        .where(
          and(
            eq(agentSettings.tenantId, id),
            eq(agentSettings.dailyBrief, true),
            sql`${agentSettings.briefSentOn} is distinct from ${today}`,
          ),
        )
        .returning({ tenantId: agentSettings.tenantId });
      return rows.length > 0;
    });
    if (claimed) due.push(id);
  }
  return due;
}
