import {
  agentSettings,
  conversations,
  handoffs,
  member,
  tenants,
  user,
  withTenant,
  type Database,
} from "@voicedesk/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { toLang, type Lang } from "./languages";
import type { ConversationState } from "./state";
import type { ConversationSummary } from "./summary";

/**
 * Post-call summary email (brief Phase 2: "receive a summary email within 60 s"). Sent to the
 * business's owners and admins after the summary is written. No transcript, only what
 * the business needs to act on (PII minimisation); the full call is behind sign-in.
 */

interface Labels {
  subject: (business: string, intent: string) => string;
  newCall: string;
  caller: string;
  withheld: string;
  when: string;
  duration: string;
  outcome: string;
  actions: string;
  records: string;
  followUp: string;
  /** Phase 5: the caller spoke with someone from the VA console. */
  spokeWith: string;
  /** Phase 5: the caller asked for a person but nobody answered the console in time. */
  nobodyAnswered: string;
  open: string;
  intents: Record<ConversationSummary["intent"], string>;
}

const LABELS: Record<Lang, Labels> = {
  en: {
    subject: (b, i) => `${b}: new call (${i})`,
    newCall: "Your assistant handled a call.",
    caller: "Caller",
    withheld: "Number withheld",
    when: "When",
    duration: "Duration",
    outcome: "Outcome",
    actions: "Action items",
    records: "Records created",
    followUp: "Follow-up needed",
    spokeWith: "Spoke with",
    nobodyAnswered: "Asked for a person; nobody answered the VA console in time",
    open: "Open the call (transcript and recording)",
    intents: {
      enquiry: "enquiry",
      signup: "sign-up",
      complaint: "complaint",
      booking: "booking",
      change_booking: "changed a booking",
      message: "message",
      human: "asked for a person",
      emergency: "emergency",
      other: "other",
    },
  },
  es: {
    subject: (b, i) => `${b}: nueva llamada (${i})`,
    newCall: "Su asistente ha atendido una llamada.",
    caller: "Llamante",
    withheld: "Número oculto",
    when: "Fecha",
    duration: "Duración",
    outcome: "Resultado",
    actions: "Tareas",
    records: "Registros creados",
    followUp: "Requiere seguimiento",
    spokeWith: "Habló con",
    nobodyAnswered: "Pidió hablar con una persona; nadie respondió a tiempo en la consola",
    open: "Ver la llamada (transcripción y grabación)",
    intents: {
      enquiry: "consulta",
      signup: "alta",
      complaint: "queja",
      booking: "reserva",
      change_booking: "cambio de reserva",
      message: "mensaje",
      human: "pidió hablar con una persona",
      emergency: "emergencia",
      other: "otro",
    },
  },
  fr: {
    subject: (b, i) => `${b} : nouvel appel (${i})`,
    newCall: "Votre assistant a traité un appel.",
    caller: "Appelant",
    withheld: "Numéro masqué",
    when: "Date",
    duration: "Durée",
    outcome: "Résultat",
    actions: "Actions à mener",
    records: "Enregistrements créés",
    followUp: "Suivi nécessaire",
    spokeWith: "A parlé avec",
    nobodyAnswered: "A demandé une personne ; personne n'a répondu à temps sur la console",
    open: "Ouvrir l'appel (transcription et enregistrement)",
    intents: {
      enquiry: "demande d'information",
      signup: "inscription",
      complaint: "réclamation",
      booking: "réservation",
      change_booking: "modification de réservation",
      message: "message",
      human: "a demandé une personne",
      emergency: "urgence",
      other: "autre",
    },
  },
  de: {
    subject: (b, i) => `${b}: neuer Anruf (${i})`,
    newCall: "Ihr Assistent hat einen Anruf bearbeitet.",
    caller: "Anrufer",
    withheld: "Rufnummer unterdrückt",
    when: "Zeitpunkt",
    duration: "Dauer",
    outcome: "Ergebnis",
    actions: "Aufgaben",
    records: "Erstellte Einträge",
    followUp: "Rückmeldung nötig",
    spokeWith: "Gesprochen mit",
    nobodyAnswered:
      "Wollte eine Person sprechen; an der Konsole hat niemand rechtzeitig angenommen",
    open: "Anruf öffnen (Transkript und Aufnahme)",
    intents: {
      enquiry: "Anfrage",
      signup: "Anmeldung",
      complaint: "Beschwerde",
      booking: "Buchung",
      change_booking: "Buchungsänderung",
      message: "Nachricht",
      human: "wollte eine Person sprechen",
      emergency: "Notfall",
      other: "Sonstiges",
    },
  },
  zh: {
    subject: (b, i) => `${b}：新来电（${i}）`,
    newCall: "您的助理处理了一通来电。",
    caller: "来电者",
    withheld: "隐藏号码",
    when: "时间",
    duration: "时长",
    outcome: "结果",
    actions: "待办事项",
    records: "已创建记录",
    followUp: "需要跟进",
    spokeWith: "通话人员",
    nobodyAnswered: "来电者要求转人工，但无人及时接听",
    open: "查看通话（文字记录和录音）",
    intents: {
      enquiry: "咨询",
      signup: "注册",
      complaint: "投诉",
      booking: "预约",
      change_booking: "更改预约",
      message: "留言",
      human: "要求人工",
      emergency: "紧急情况",
      other: "其他",
    },
  },
  ar: {
    subject: (b, i) => `${b}: مكالمة جديدة (${i})`,
    newCall: "تعامل مساعدك مع مكالمة.",
    caller: "المتصل",
    withheld: "رقم محجوب",
    when: "الوقت",
    duration: "المدة",
    outcome: "النتيجة",
    actions: "مهام مطلوبة",
    records: "سجلات تم إنشاؤها",
    followUp: "تحتاج إلى متابعة",
    spokeWith: "تحدث مع",
    nobodyAnswered: "طلب التحدث إلى شخص، لكن لم يرد أحد في الوقت المناسب",
    open: "فتح المكالمة (النص والتسجيل)",
    intents: {
      enquiry: "استفسار",
      signup: "تسجيل",
      complaint: "شكوى",
      booking: "حجز",
      change_booking: "تعديل حجز",
      message: "رسالة",
      human: "طلب التحدث إلى شخص",
      emergency: "طوارئ",
      other: "أخرى",
    },
  },
};

/** The parts of the AI summary the email uses. */
export type CallEmailSummary = Pick<
  ConversationSummary,
  "intent" | "outcome" | "summary" | "actionItems" | "followUpNeeded"
>;

export interface CallEmailInput {
  businessName: string;
  language: Lang;
  timezone: string;
  callerPhone: string | null;
  withheld: boolean;
  startedAt: Date;
  durationSeconds: number | null;
  records: Array<{ type: string; reference: string }>;
  summary: CallEmailSummary;
  link: string;
  /** Phase 5: the person who took over from the assistant, or that nobody answered. */
  person?: { name: string; seconds: number | null } | { missed: true } | null;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "–";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

export function buildCallSummaryEmail(input: CallEmailInput): { subject: string; text: string } {
  const l = LABELS[input.language];
  const when = new Intl.DateTimeFormat(input.language === "zh" ? "zh-CN" : input.language, {
    timeZone: input.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(input.startedAt);
  const lines = [
    l.newCall,
    "",
    `${l.caller}: ${input.callerPhone ?? l.withheld}`,
    `${l.when}: ${when}`,
    `${l.duration}: ${formatDuration(input.durationSeconds)}`,
    `${l.outcome}: ${input.summary.outcome}`,
    "",
    input.summary.summary,
  ];
  if (input.summary.actionItems.length) {
    lines.push("", `${l.actions}:`, ...input.summary.actionItems.map((a) => `- ${a}`));
  }
  if (input.records.length) {
    lines.push("", `${l.records}: ${input.records.map((r) => r.reference).join(", ")}`);
  }
  if (input.person && "missed" in input.person) {
    lines.push("", l.nobodyAnswered);
  } else if (input.person) {
    lines.push(
      "",
      `${l.spokeWith}: ${input.person.name} (${formatDuration(input.person.seconds)})`,
    );
  }
  if (input.summary.followUpNeeded) lines.push("", `⚠ ${l.followUp}`);
  lines.push("", `${l.open}: ${input.link}`);
  const intent = l.intents[input.summary.intent];
  return {
    subject: `${input.summary.followUpNeeded ? "⚠ " : ""}${l.subject(input.businessName, intent)}`,
    text: lines.join("\n"),
  };
}

/**
 * Emails for a finished phone call: one per owner/admin. Empty for browser test calls, chats,
 * or calls without a summary.
 */
export async function prepareCallSummaryEmails(
  db: Database,
  tenantId: string,
  conversationId: string,
  webOrigin: string,
): Promise<Array<{ to: string; subject: string; text: string }>> {
  const data = await withTenant(db, tenantId, async (tx) => {
    const [call] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const [settings] = await tx
      .select({ adminLanguage: agentSettings.adminLanguage })
      .from(agentSettings)
      .where(eq(agentSettings.tenantId, tenantId));
    // The latest handoff to a person on this call, with who answered.
    const [handoff] = await tx
      .select({
        status: handoffs.status,
        answeredAt: handoffs.answeredAt,
        endedAt: handoffs.endedAt,
        name: user.name,
      })
      .from(handoffs)
      .leftJoin(user, eq(user.id, handoffs.answeredBy))
      .where(eq(handoffs.conversationId, conversationId))
      .orderBy(desc(handoffs.queuedAt))
      .limit(1);
    return { call, tenant, settings, handoff };
  });
  const { call, tenant } = data;
  if (!call || !tenant || call.channel !== "voice" || !call.summary) return [];
  const recipients = await db
    .select({ email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, tenantId), inArray(member.role, ["owner", "admin"])));
  if (recipients.length === 0) return [];
  const state = call.state as unknown as ConversationState;
  const email = buildCallSummaryEmail({
    businessName: tenant.name,
    language: toLang(data.settings?.adminLanguage, "en"),
    timezone: tenant.timezone,
    callerPhone: call.callerNumberWithheld ? null : (state.callerPhone ?? null),
    withheld: call.callerNumberWithheld,
    startedAt: call.startedAt,
    durationSeconds: call.endedAt
      ? Math.round((call.endedAt.getTime() - call.startedAt.getTime()) / 1000)
      : null,
    records: state.records ?? [],
    summary: call.summary as unknown as CallEmailSummary,
    link: `${webOrigin}/t/${tenantId}/calls/${conversationId}`,
    person: personFor(data.handoff),
  });
  return recipients.map((r) => ({ to: r.email, ...email }));
}

function personFor(
  handoff:
    | { status: string; answeredAt: Date | null; endedAt: Date | null; name: string | null }
    | undefined,
): CallEmailInput["person"] {
  if (!handoff) return null;
  if (handoff.status === "missed") return { missed: true };
  if (!handoff.answeredAt) return null;
  return {
    name: handoff.name?.split(" ")[0] ?? "—",
    seconds: handoff.endedAt
      ? Math.round((handoff.endedAt.getTime() - handoff.answeredAt.getTime()) / 1000)
      : null,
  };
}
