import type { AgentContext } from "./context";
import type { Lang } from "./languages";
import type { AgentServices } from "./services";
import type { ConversationState } from "./state";
import { normalisePhone } from "./util";

/**
 * Take-a-message mode without AI (security batch 4, ADR 0022): used when the business's AI
 * spend cap is reached or the platform has paused AI. Fixed questions (name, number, message)
 * so customers are never left without a way to reach the business, and nothing costs AI.
 */

type Phrase = (a: { name?: string; reference?: string; business?: string }) => string;

const PHRASES: Record<
  "start" | "askPhone" | "badPhone" | "askMessage" | "done" | "unavailable",
  Record<Lang, Phrase>
> = {
  start: {
    en: () =>
      "I'm sorry, I can't answer questions right now, but I can take a message for the team. What's your name?",
    es: () =>
      "Lo siento, ahora mismo no puedo responder preguntas, pero puedo tomar un mensaje para el equipo. ¿Cómo se llama?",
    fr: () =>
      "Je suis désolé, je ne peux pas répondre aux questions pour le moment, mais je peux prendre un message pour l'équipe. Quel est votre nom ?",
    de: () =>
      "Es tut mir leid, ich kann gerade keine Fragen beantworten, aber ich kann eine Nachricht für das Team aufnehmen. Wie ist Ihr Name?",
    zh: () => "抱歉，我现在无法回答问题，但可以为团队记下留言。请问您怎么称呼？",
    ar: () => "عذراً، لا يمكنني الإجابة عن الأسئلة الآن، لكن يمكنني تسجيل رسالة للفريق. ما اسمك؟",
  },
  askPhone: {
    en: (a) => `Thank you, ${a.name}. What's the best phone number to reach you on?`,
    es: (a) => `Gracias, ${a.name}. ¿En qué número de teléfono podemos contactarle?`,
    fr: (a) => `Merci, ${a.name}. À quel numéro de téléphone pouvons-nous vous joindre ?`,
    de: (a) => `Danke, ${a.name}. Unter welcher Telefonnummer erreichen wir Sie am besten?`,
    zh: (a) => `谢谢您，${a.name}。请问打哪个电话号码能联系到您？`,
    ar: (a) => `شكراً لك يا ${a.name}. ما أفضل رقم هاتف للتواصل معك؟`,
  },
  badPhone: {
    en: () => "Sorry, that doesn't look like a full phone number. Could you give it again?",
    es: () => "Perdone, eso no parece un número de teléfono completo. ¿Podría repetirlo?",
    fr: () =>
      "Désolé, cela ne ressemble pas à un numéro de téléphone complet. Pouvez-vous le redonner ?",
    de: () =>
      "Entschuldigung, das sieht nicht nach einer vollständigen Telefonnummer aus. Können Sie sie noch einmal nennen?",
    zh: () => "抱歉，这看起来不是完整的电话号码。可以再说一遍吗？",
    ar: () => "عذراً، لا يبدو هذا رقم هاتف كاملاً. هل يمكنك إعادته؟",
  },
  askMessage: {
    en: () => "And what would you like the message to say?",
    es: () => "¿Y qué mensaje quiere dejar?",
    fr: () => "Et quel message souhaitez-vous laisser ?",
    de: () => "Und was soll in der Nachricht stehen?",
    zh: () => "请问您想留什么言？",
    ar: () => "وما الرسالة التي تودّ تركها؟",
  },
  done: {
    en: (a) =>
      `Thank you. I've passed your message to the team (reference ${a.reference}). Someone will get back to you as soon as they can.`,
    es: (a) =>
      `Gracias. He pasado su mensaje al equipo (referencia ${a.reference}). Le responderán lo antes posible.`,
    fr: (a) =>
      `Merci. J'ai transmis votre message à l'équipe (référence ${a.reference}). Quelqu'un vous recontactera dès que possible.`,
    de: (a) =>
      `Danke. Ich habe Ihre Nachricht an das Team weitergegeben (Referenz ${a.reference}). Man meldet sich so bald wie möglich bei Ihnen.`,
    zh: (a) => `谢谢。我已把您的留言转给团队（编号 ${a.reference}），他们会尽快联系您。`,
    ar: (a) =>
      `شكراً لك. لقد نقلت رسالتك إلى الفريق (الرقم المرجعي ${a.reference}). سيتواصل معك أحدهم في أقرب وقت ممكن.`,
  },
  unavailable: {
    en: (a) =>
      `Sorry, this service isn't available right now. Please contact ${a.business} another way.`,
    es: (a) =>
      `Lo siento, este servicio no está disponible ahora mismo. Póngase en contacto con ${a.business} por otro medio.`,
    fr: (a) =>
      `Désolé, ce service n'est pas disponible pour le moment. Veuillez contacter ${a.business} par un autre moyen.`,
    de: (a) =>
      `Entschuldigung, dieser Dienst ist gerade nicht verfügbar. Bitte kontaktieren Sie ${a.business} auf anderem Weg.`,
    zh: (a) => `抱歉，此服务目前不可用。请通过其他方式联系${a.business}。`,
    ar: (a) => `عذراً، هذه الخدمة غير متاحة الآن. يرجى التواصل مع ${a.business} بطريقة أخرى.`,
  },
};

export function unavailablePhrase(lang: Lang, business: string): string {
  return PHRASES.unavailable[lang]({ business });
}

export interface MessageOnlyResult {
  reply: string;
  /** Set when the message was saved this turn. */
  reference?: string;
}

/**
 * One turn of take-a-message mode. Mutates `state.messageOnly` and records the saved message
 * in `state.records`; the caller appends history like any other turn.
 */
export async function messageOnlyTurn(
  services: AgentServices,
  ctx: AgentContext,
  state: ConversationState,
  callerText: string,
): Promise<MessageOnlyResult> {
  const lang = state.language;
  const m = (state.messageOnly ??= { step: "start" });
  const text = callerText.trim().slice(0, 1000);

  if (m.step === "done") {
    const reference = state.records.find((r) => r.type === "message")?.reference ?? "";
    return { reply: PHRASES.done[lang]({ reference }) };
  }
  if (m.step === "start") {
    m.step = "name";
    return { reply: PHRASES.start[lang]({}) };
  }
  if (m.step === "name") {
    m.name = text.slice(0, 100) || "Unknown";
    if (state.callerPhone) {
      m.phone = state.callerPhone;
      m.step = "message";
      return { reply: PHRASES.askMessage[lang]({}) };
    }
    m.step = "phone";
    return { reply: PHRASES.askPhone[lang]({ name: m.name }) };
  }
  if (m.step === "phone") {
    const phone = normalisePhone(text, ctx.countryCode);
    if (!phone) return { reply: PHRASES.badPhone[lang]({}) };
    m.phone = phone;
    m.step = "message";
    return { reply: PHRASES.askMessage[lang]({}) };
  }
  // m.step === "message"
  const created = await services.takeMessage({
    callerName: m.name ?? "Unknown",
    callerPhone: m.phone ?? state.callerPhone ?? "",
    reason: text || "(no message given)",
    urgency: "normal",
  });
  state.records.push({ type: "message", ...created });
  m.step = "done";
  return {
    reply: PHRASES.done[lang]({ reference: created.reference }),
    reference: created.reference,
  };
}
