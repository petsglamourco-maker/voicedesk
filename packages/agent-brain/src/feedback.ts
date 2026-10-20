import { randomBytes } from "node:crypto";
import {
  agentSettings,
  conversationMessages,
  conversations,
  feedback,
  handoffs,
  withTenant,
  type Database,
} from "@voicedesk/db";
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { toLang, type Lang } from "./languages";

/**
 * Customer feedback (Phase 6, ADR 0020): one short question at the end of a conversation,
 * CSAT 1–5 or (every Nth time) NPS 0–10. Fixed wording in every language, never generated.
 */

export type FeedbackKind = "csat" | "nps";
export type FeedbackRow = typeof feedback.$inferSelect;

/** Nobody is asked again within this many days. */
export const SURVEY_COOLDOWN_DAYS = 30;
/** A reply to an in-chat question counts for this long. */
export const SURVEY_REPLY_HOURS = 24;

const MAX: Record<FeedbackKind, number> = { csat: 5, nps: 10 };
const MIN: Record<FeedbackKind, number> = { csat: 1, nps: 0 };

const QUESTION: Record<Lang, Record<FeedbackKind, (business: string) => string>> = {
  en: {
    csat: () => "How did we do today? Reply with a number from 1 (poor) to 5 (excellent).",
    nps: (b) =>
      `How likely are you to recommend ${b} to a friend? Reply 0 (not at all) to 10 (very likely).`,
  },
  es: {
    csat: () =>
      "¿Qué tal le hemos atendido hoy? Responda con un número del 1 (mal) al 5 (excelente).",
    nps: (b) =>
      `¿Qué probabilidad hay de que recomiende ${b} a un amigo? Responda del 0 (ninguna) al 10 (muy probable).`,
  },
  fr: {
    csat: () =>
      "Comment s'est passé votre échange aujourd'hui ? Répondez par un chiffre de 1 (mauvais) à 5 (excellent).",
    nps: (b) =>
      `Quelle est la probabilité que vous recommandiez ${b} à un ami ? Répondez de 0 (pas du tout) à 10 (très probable).`,
  },
  de: {
    csat: () =>
      "Wie zufrieden waren Sie heute? Antworten Sie mit einer Zahl von 1 (schlecht) bis 5 (ausgezeichnet).",
    nps: (b) =>
      `Wie wahrscheinlich ist es, dass Sie ${b} weiterempfehlen? Antworten Sie mit 0 (gar nicht) bis 10 (sehr wahrscheinlich).`,
  },
  zh: {
    csat: () => "您对今天的服务满意吗？请回复 1（很差）到 5（很好）之间的数字。",
    nps: (b) => `您有多大可能向朋友推荐${b}？请回复 0（不可能）到 10（非常可能）。`,
  },
  ar: {
    csat: () => "ما مدى رضاك عن خدمتنا اليوم؟ أرسل رقمًا من 1 (سيئ) إلى 5 (ممتاز).",
    nps: (b) =>
      `ما مدى احتمال أن توصي بـ ${b} لصديق؟ أرسل رقمًا من 0 (غير محتمل) إلى 10 (محتمل جدًا).`,
  },
};

/** With buttons (website chat) the "reply with a number" part is left out. */
const SHORT_QUESTION: Record<Lang, Record<FeedbackKind, (business: string) => string>> = {
  en: { csat: () => "How did we do today?", nps: (b) => `How likely are you to recommend ${b}?` },
  es: { csat: () => "¿Qué tal le hemos atendido hoy?", nps: (b) => `¿Recomendaría ${b}?` },
  fr: {
    csat: () => "Comment s'est passé votre échange ?",
    nps: (b) => `Recommanderiez-vous ${b} ?`,
  },
  de: {
    csat: () => "Wie zufrieden waren Sie heute?",
    nps: (b) => `Würden Sie ${b} weiterempfehlen?`,
  },
  zh: { csat: () => "您对今天的服务满意吗？", nps: (b) => `您会推荐${b}吗？` },
  ar: { csat: () => "ما مدى رضاك عن خدمتنا اليوم؟", nps: (b) => `هل توصي بـ ${b}؟` },
};

const LINK_INVITE: Record<Lang, (business: string, link: string) => string> = {
  en: (b, l) => `Thanks for contacting ${b}. How did we do? It takes 5 seconds: ${l}`,
  es: (b, l) => `Gracias por contactar con ${b}. ¿Qué tal le atendimos? Son 5 segundos: ${l}`,
  fr: (b, l) => `Merci d'avoir contacté ${b}. Comment s'est passé l'échange ? 5 secondes : ${l}`,
  de: (b, l) =>
    `Danke für Ihren Kontakt mit ${b}. Wie zufrieden waren Sie? Dauert 5 Sekunden: ${l}`,
  zh: (b, l) => `感谢您联系${b}。请花 5 秒钟为我们的服务评分：${l}`,
  ar: (b, l) => `شكرًا لتواصلك مع ${b}. ما رأيك في خدمتنا؟ يستغرق الأمر 5 ثوانٍ: ${l}`,
};

const THANKS: Record<Lang, string> = {
  en: "Thank you for your feedback!",
  es: "¡Gracias por su opinión!",
  fr: "Merci pour votre avis !",
  de: "Vielen Dank für Ihr Feedback!",
  zh: "感谢您的反馈！",
  ar: "شكرًا على ملاحظاتك!",
};

export function surveyQuestion(lang: Lang, kind: FeedbackKind, business: string): string {
  return QUESTION[lang][kind](business);
}
export function shortSurveyQuestion(lang: Lang, kind: FeedbackKind, business: string): string {
  return SHORT_QUESTION[lang][kind](business);
}
export function surveyLinkInvite(lang: Lang, business: string, link: string): string {
  return LINK_INVITE[lang](business, link);
}
export function feedbackThanks(lang: Lang): string {
  return THANKS[lang];
}

/** "4", "4/5", " 9 ", "10!" → the score; anything else (a real message) → null. */
export function parseScore(text: string, kind: FeedbackKind): number | null {
  const match = /^\s*(\d{1,2})\s*(?:\/\s*(?:5|10))?\s*[.!]?\s*$/.exec(text);
  if (!match) return null;
  const score = Number(match[1]);
  return score >= MIN[kind] && score <= MAX[kind] ? score : null;
}

export function isLowScore(kind: FeedbackKind, score: number): boolean {
  return kind === "csat" ? score <= 2 : score <= 6;
}

export interface OpenedSurvey {
  id: string;
  token: string;
  kind: FeedbackKind;
  language: Lang;
}

/**
 * Starts a survey for a finished conversation, or returns null when the business has
 * surveys off, the conversation already has one, or this customer was asked recently.
 */
export async function openSurvey(
  db: Database,
  params: {
    tenantId: string;
    conversationId: string;
    channel: string;
    now?: Date;
    /** Phone calls ask only when the business switched on texts after calls. */
    afterCall?: boolean;
  },
): Promise<OpenedSurvey | null> {
  const { tenantId, conversationId } = params;
  const now = params.now ?? new Date();
  return withTenant(db, tenantId, async (tx) => {
    const [settings] = await tx
      .select()
      .from(agentSettings)
      .where(eq(agentSettings.tenantId, tenantId));
    if (settings && !settings.feedbackEnabled) return null;
    if (params.afterCall && !settings?.feedbackAfterCalls) return null;
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!conversation || conversation.channel === "test_console") return null;
    const [existing] = await tx
      .select({ id: feedback.id })
      .from(feedback)
      .where(eq(feedback.conversationId, conversationId));
    if (existing) return null;
    if (conversation.contactId) {
      const since = new Date(now.getTime() - SURVEY_COOLDOWN_DAYS * 24 * 3600 * 1000);
      const [recent] = await tx
        .select({ id: feedback.id })
        .from(feedback)
        .where(
          and(
            eq(feedback.tenantId, tenantId),
            eq(feedback.contactId, conversation.contactId),
            gt(feedback.sentAt, since),
          ),
        );
      if (recent) return null;
    }
    // Every Nth survey asks NPS instead of CSAT.
    const npsEvery = settings?.npsEvery ?? 0;
    let kind: FeedbackKind = "csat";
    if (npsEvery > 0) {
      const [{ n }] = (await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(feedback)
        .where(eq(feedback.tenantId, tenantId))) as [{ n: number }];
      if ((n + 1) % npsEvery === 0) kind = "nps";
    }
    const handledBy = (await handledByPerson(tx, conversationId)) ? "person" : "ai";
    const language = toLang(conversation.language, "en");
    const token = `${tenantId}.${randomBytes(18).toString("base64url")}`;
    const [row] = await tx
      .insert(feedback)
      .values({
        tenantId,
        conversationId,
        contactId: conversation.contactId,
        channel: params.channel,
        kind,
        token,
        handledBy,
        language,
        sentAt: now,
      })
      .onConflictDoNothing()
      .returning();
    return row ? { id: row.id, token, kind, language } : null;
  });
}

type Tx = Parameters<Parameters<typeof withTenant>[2]>[0];

async function handledByPerson(tx: Tx, conversationId: string): Promise<boolean> {
  const [answered] = await tx
    .select({ id: handoffs.id })
    .from(handoffs)
    .where(and(eq(handoffs.conversationId, conversationId), isNotNull(handoffs.answeredAt)));
  if (answered) return true;
  const [human] = await tx
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        sql`${conversationMessages.metadata}->>'human' = 'true'`,
      ),
    )
    .limit(1);
  return Boolean(human);
}

/** The survey behind a public rating link ("<tenantId>.<random>"), or null. */
export async function surveyByToken(db: Database, token: string): Promise<FeedbackRow | null> {
  const tenantId = token.split(".")[0] ?? "";
  if (!/^[0-9a-f-]{36}$/.test(tenantId)) return null;
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx.select().from(feedback).where(eq(feedback.token, token)),
  );
  return row ?? null;
}

/** The unanswered in-chat survey of this conversation (WhatsApp / SMS replies), if recent. */
export async function pendingSurvey(
  db: Database,
  tenantId: string,
  conversationId: string,
  now: Date = new Date(),
): Promise<FeedbackRow | null> {
  const since = new Date(now.getTime() - SURVEY_REPLY_HOURS * 3600 * 1000);
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .select()
      .from(feedback)
      .where(
        and(
          eq(feedback.tenantId, tenantId),
          eq(feedback.conversationId, conversationId),
          gt(feedback.sentAt, since),
        ),
      )
      .orderBy(desc(feedback.sentAt))
      .limit(1),
  );
  return row && row.score === null ? row : null;
}

/**
 * Saves the customer's answer (first answer only; a comment may be added afterwards).
 * Returns the row and whether the score is low enough to alert the business.
 */
export async function recordFeedback(
  db: Database,
  tenantId: string,
  id: string,
  answer: { score?: number; comment?: string | null },
  now: Date = new Date(),
): Promise<{ row: FeedbackRow; low: boolean; first: boolean } | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [current] = await tx.select().from(feedback).where(eq(feedback.id, id));
    if (!current) return null;
    const kind = current.kind as FeedbackKind;
    const first = current.score === null && answer.score !== undefined;
    if (answer.score !== undefined) {
      if (answer.score < MIN[kind] || answer.score > MAX[kind]) return null;
    }
    const [row] = await tx
      .update(feedback)
      .set({
        ...(first ? { score: answer.score, answeredAt: now } : {}),
        ...(answer.comment ? { comment: answer.comment.slice(0, 1000) } : {}),
      })
      .where(eq(feedback.id, id))
      .returning();
    return { row: row!, low: first && isLowScore(kind, answer.score!), first };
  });
}

export interface FeedbackStats {
  sent: number;
  answered: number;
  /** % of CSAT answers that were 4 or 5. */
  csat: number | null;
  csatAverage: number | null;
  /** % promoters (9–10) minus % detractors (0–6). */
  nps: number | null;
  npsAnswers: number;
}

/** Scores over a set of surveys (pure, so the maths is tested on its own). */
export function feedbackStats(rows: Array<Pick<FeedbackRow, "kind" | "score">>): FeedbackStats {
  const answered = rows.filter((r) => r.score !== null);
  const csat = answered.filter((r) => r.kind === "csat").map((r) => r.score!);
  const nps = answered.filter((r) => r.kind === "nps").map((r) => r.score!);
  const pct = (part: number, whole: number) => Math.round((part / whole) * 100);
  return {
    sent: rows.length,
    answered: answered.length,
    csat: csat.length ? pct(csat.filter((s) => s >= 4).length, csat.length) : null,
    csatAverage: csat.length
      ? Math.round((csat.reduce((a, b) => a + b, 0) / csat.length) * 10) / 10
      : null,
    nps: nps.length
      ? pct(nps.filter((s) => s >= 9).length, nps.length) -
        pct(nps.filter((s) => s <= 6).length, nps.length)
      : null,
    npsAnswers: nps.length,
  };
}
