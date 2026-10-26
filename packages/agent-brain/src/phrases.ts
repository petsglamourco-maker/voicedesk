import type { Lang } from "./languages";

/**
 * Fixed phrases the engine says itself (not the LLM), so they are always present and
 * correct: the opening greeting with AI disclosure (mandatory, brief §3.3), emergency
 * guidance, and graceful-degradation fallbacks.
 */

interface GreetingArgs {
  business: string;
  name: string;
  gender: "female" | "male";
}

const GREETINGS: Record<Lang, (a: GreetingArgs) => string> = {
  en: (a) =>
    `Hello, you're through to ${a.business}. I'm ${a.name}, the AI assistant here. How can I help you today?`,
  es: (a) =>
    `Hola, ha contactado con ${a.business}. Soy ${a.name}, ${a.gender === "female" ? "la asistente" : "el asistente"} de inteligencia artificial. ¿En qué puedo ayudarle hoy?`,
  fr: (a) =>
    `Bonjour, vous êtes bien chez ${a.business}. Je suis ${a.name}, ${a.gender === "female" ? "l'assistante" : "l'assistant"} IA. Comment puis-je vous aider aujourd'hui ?`,
  de: (a) =>
    `Hallo, Sie sind verbunden mit ${a.business}. Ich bin ${a.name}, ${a.gender === "female" ? "die KI-Assistentin" : "der KI-Assistent"}. Wie kann ich Ihnen heute helfen?`,
  zh: (a) =>
    `您好，这里是${a.business}。我是${a.name}，这里的人工智能助理。请问今天有什么可以帮您？`,
  ar: (a) =>
    `مرحباً، معك ${a.business}. أنا ${a.name}، ${a.gender === "female" ? "المساعدة الذكية المدعومة" : "المساعد الذكي المدعوم"} بالذكاء الاصطناعي. كيف يمكنني مساعدتك اليوم؟`,
};

export function greeting(lang: Lang, args: GreetingArgs): string {
  return GREETINGS[lang](args);
}

/** The question that ends each greeting (replaced by the menu when there is one). */
const QUESTION: Record<Lang, string> = {
  en: "How can I help you today?",
  es: "¿En qué puedo ayudarle hoy?",
  fr: "Comment puis-je vous aider aujourd'hui ?",
  de: "Wie kann ich Ihnen heute helfen?",
  zh: "请问今天有什么可以帮您？",
  ar: "كيف يمكنني مساعدتك اليوم؟",
};

/** Missed-call receptionist (ADR 0025): said after the AI disclosure. */
const MISSED: Record<Lang, string> = {
  en: "The team couldn't get to the phone just now, but I can book you in, arrange a call back or take a message.",
  es: "El equipo no ha podido atender ahora mismo, pero puedo darle una cita, programar una llamada o tomar un mensaje.",
  fr: "L'équipe n'a pas pu répondre pour le moment, mais je peux vous donner un rendez-vous, organiser un rappel ou prendre un message.",
  de: "Das Team konnte gerade nicht rangehen, aber ich kann einen Termin vereinbaren, einen Rückruf einplanen oder eine Nachricht aufnehmen.",
  zh: "团队刚才没能接听电话，不过我可以帮您预约、安排回电或留言。",
  ar: "لم يتمكن الفريق من الرد الآن، لكن يمكنني حجز موعد لك أو ترتيب معاودة الاتصال أو تسجيل رسالة.",
};

/**
 * The opening: always the greeting with the AI disclosure first, then (optionally) the
 * missed-call line and the recording notice, then the question or the department menu.
 */
export function openingGreeting(
  lang: Lang,
  args: GreetingArgs,
  options: {
    missed?: boolean;
    recordingNotice?: boolean;
    menu?: string | null;
    /** Ring the team first: "Let me try the team for you" instead of the question. */
    ringFirst?: boolean;
  } = {},
): string {
  const full = GREETINGS[lang](args);
  const intro = full.endsWith(QUESTION[lang])
    ? full.slice(0, -QUESTION[lang].length).trimEnd()
    : full;
  const parts = [intro];
  if (options.missed) parts.push(MISSED[lang]);
  if (options.recordingNotice) parts.push(RECORDING_NOTICE[lang]);
  parts.push(options.menu ?? (options.ringFirst ? TRY_TEAM[lang] : QUESTION[lang]));
  return parts.join(lang === "zh" ? "" : " ");
}

const RECORDING_NOTICE: Record<Lang, string> = {
  en: "Just so you know, this call is recorded for quality and training.",
  es: "Le informamos de que esta llamada se graba con fines de calidad y formación.",
  fr: "Pour information, cet appel est enregistré à des fins de qualité et de formation.",
  de: "Zu Ihrer Information: Dieses Gespräch wird zu Qualitäts- und Schulungszwecken aufgezeichnet.",
  zh: "温馨提示，本次通话将被录音，用于质量和培训。",
  ar: "للعلم، يتم تسجيل هذه المكالمة لأغراض الجودة والتدريب.",
};

export function recordingNotice(lang: Lang): string {
  return RECORDING_NOTICE[lang];
}

/**
 * Spoken when a voice reply is slow (e.g. a lookup), so the caller isn't left in silence.
 * Rotated so the same words never come twice in a row.
 */
const HOLD_ON: Record<Lang, string[]> = {
  en: ["Just a moment.", "One second, please.", "Let me just check."],
  es: ["Un momento.", "Un segundo, por favor.", "Déjeme comprobarlo."],
  fr: ["Un instant.", "Une seconde, s'il vous plaît.", "Je vérifie."],
  de: ["Einen Moment.", "Eine Sekunde, bitte.", "Ich schaue kurz nach."],
  zh: ["请稍等。", "稍等一下。", "我查一下。"],
  ar: ["لحظة من فضلك.", "ثانية واحدة من فضلك.", "دعني أتحقق."],
};

/** The `n`th hold-on phrase of the call (0, 1, 2…), cycling through the variants. */
export function holdOnPhrase(lang: Lang, n = 0): string {
  const phrases = HOLD_ON[lang];
  return phrases[n % phrases.length]!;
}

/** Phone silence handling: a check after a quiet spell, then a goodbye before hanging up. */
const STILL_THERE: Record<Lang, string> = {
  en: "Are you still there?",
  es: "¿Sigue ahí?",
  fr: "Vous êtes toujours là ?",
  de: "Sind Sie noch da?",
  zh: "请问您还在吗？",
  ar: "هل ما زلت معي؟",
};

const SILENT_GOODBYE: Record<Lang, string> = {
  en: "I can't hear anything, so I'll end the call now. Please call back any time. Goodbye.",
  es: "No le oigo, así que voy a terminar la llamada. Llámenos cuando quiera. Adiós.",
  fr: "Je ne vous entends plus, je vais donc raccrocher. N'hésitez pas à rappeler. Au revoir.",
  de: "Ich höre leider nichts mehr, deshalb beende ich das Gespräch. Rufen Sie gern wieder an. Auf Wiederhören.",
  zh: "我听不到您的声音，现在先挂断电话。欢迎随时再打来。再见。",
  ar: "لا أستطيع سماعك، لذا سأنهي المكالمة الآن. يمكنك الاتصال بنا في أي وقت. مع السلامة.",
};

/** ADR 0029: the end of an instant-demo call (they're capped at a few minutes). */
const DEMO_TIME_UP: Record<Lang, string> = {
  en: "That's the end of this demo call. Thanks for trying your VoiceDesk assistant. Goodbye.",
  es: "Aquí termina esta llamada de demostración. Gracias por probar su asistente VoiceDesk. Adiós.",
  fr: "C'est la fin de cet appel de démonstration. Merci d'avoir essayé votre assistant VoiceDesk. Au revoir.",
  de: "Das ist das Ende dieses Demo-Anrufs. Danke, dass Sie Ihren VoiceDesk-Assistenten ausprobiert haben. Auf Wiederhören.",
  zh: "本次演示通话到此结束。感谢您试用 VoiceDesk 助理。再见。",
  ar: "انتهت مكالمة العرض التجريبي. شكرًا لتجربة مساعد VoiceDesk. مع السلامة.",
};

export function demoTimeUpPhrase(lang: Lang): string {
  return DEMO_TIME_UP[lang];
}

/** Spoken when a phone transfer fails; the assistant then offers to take a message. */
const TRANSFER_FAILED: Record<Lang, string> = {
  en: "Sorry, I couldn't put you through just now. I can take a message so they call you back. Would that help?",
  es: "Lo siento, no he podido pasarle la llamada ahora mismo. Puedo tomar un mensaje para que le devuelvan la llamada. ¿Le parece bien?",
  fr: "Désolée, je n'ai pas pu vous transférer pour le moment. Je peux prendre un message pour qu'on vous rappelle. Cela vous convient ?",
  de: "Entschuldigung, ich konnte Sie gerade nicht verbinden. Ich kann eine Nachricht für einen Rückruf aufnehmen. Wäre das in Ordnung?",
  zh: "抱歉，暂时无法为您转接。我可以帮您留言，请他们给您回电。可以吗？",
  ar: "عذراً، لم أتمكن من تحويلك الآن. يمكنني أخذ رسالة ليعاودوا الاتصال بك. هل يناسبك ذلك؟",
};

export function transferFailedPhrase(lang: Lang): string {
  return TRANSFER_FAILED[lang];
}

/** Phase 5 handoff to the VA console: spoken every so often while the console rings. */
const STILL_CONNECTING: Record<Lang, string> = {
  en: "Still connecting you, thanks for waiting.",
  es: "Sigo intentando pasarle, gracias por esperar.",
  fr: "Je vous mets toujours en relation, merci de patienter.",
  de: "Ich verbinde Sie noch, danke für Ihre Geduld.",
  zh: "正在为您转接，感谢您的耐心等待。",
  ar: "ما زلت أحاول تحويلك، شكرًا على انتظارك.",
};

export function stillConnectingPhrase(lang: Lang): string {
  return STILL_CONNECTING[lang];
}

/** When the person answers: the caller now knows they're talking to a human, and who. */
const THROUGH_TO: Record<Lang, (name: string) => string> = {
  en: (n) => `You're through to ${n} now.`,
  es: (n) => `Le paso con ${n}.`,
  fr: (n) => `Je vous passe ${n}.`,
  de: (n) => `Ich verbinde Sie jetzt mit ${n}.`,
  zh: (n) => `现在为您接通${n}。`,
  ar: (n) => `أنت الآن على اتصال مع ${n}.`,
};

export function throughToPhrase(lang: Lang, name: string): string {
  return THROUGH_TO[lang](name);
}

/** Nobody at the console picked up in time and there's no phone fallback. */
const NOBODY_FREE: Record<Lang, string> = {
  en: "I'm sorry, nobody's free to take the call right now. I can take a message so someone gets back to you.",
  es: "Lo siento, ahora mismo no hay nadie disponible. Puedo tomar un mensaje para que le devuelvan la llamada.",
  fr: "Je suis désolée, personne n'est disponible pour le moment. Je peux prendre un message pour qu'on vous rappelle.",
  de: "Es tut mir leid, gerade ist niemand frei. Ich kann gern eine Nachricht aufnehmen, damit man Sie zurückruft.",
  zh: "很抱歉，现在没有同事可以接听。我可以帮您留言，稍后会有人回复您。",
  ar: "عذرًا، لا يوجد أحد متاح للرد الآن. يمكنني أخذ رسالة ليتواصل معك أحد لاحقًا.",
};

export function nobodyFreePhrase(lang: Lang): string {
  return NOBODY_FREE[lang];
}

/** The person handed the call back: the AI disclosure again, since a human was speaking. */
const BACK_WITH_ASSISTANT: Record<Lang, string> = {
  en: "You're back with the AI assistant. Is there anything else I can help with?",
  es: "Vuelve a hablar con el asistente de IA. ¿Puedo ayudarle con algo más?",
  fr: "Vous êtes de nouveau avec l'assistante IA. Puis-je vous aider pour autre chose ?",
  de: "Sie sprechen wieder mit der KI-Assistenz. Kann ich sonst noch helfen?",
  zh: "您现在又在与人工智能助理通话。还有什么可以帮您的吗？",
  ar: "أنت الآن مع المساعد الذكي مجددًا. هل يمكنني مساعدتك في شيء آخر؟",
};

export function backWithAssistantPhrase(lang: Lang): string {
  return BACK_WITH_ASSISTANT[lang];
}

/** Email signature: who wrote it and that it's an AI assistant (disclosure on every email). */
const AI_SIGNATURE: Record<Lang, (name: string, business: string) => string> = {
  en: (n, b) => `${n}\nAI assistant, ${b}`,
  es: (n, b) => `${n}\nAsistente de IA, ${b}`,
  fr: (n, b) => `${n}\nAssistante IA, ${b}`,
  de: (n, b) => `${n}\nKI-Assistenz, ${b}`,
  zh: (n, b) => `${n}\n${b} 人工智能助理`,
  ar: (n, b) => `${n}\nمساعد الذكاء الاصطناعي، ${b}`,
};

export function aiSignature(lang: Lang, name: string, business: string): string {
  return AI_SIGNATURE[lang](name, business);
}

export function stillTherePhrase(lang: Lang): string {
  return STILL_THERE[lang];
}

export function silentGoodbyePhrase(lang: Lang): string {
  return SILENT_GOODBYE[lang];
}

const EMERGENCY: Record<Lang, (n: string) => string> = {
  en: (n) =>
    `If someone is in danger or this is a medical emergency, please hang up and call ${n} now. I'm an AI assistant and I can't send help. If it isn't an emergency, I'm happy to help.`,
  es: (n) =>
    `Si alguien está en peligro o se trata de una emergencia médica, cuelgue y llame al ${n} ahora mismo. Soy un asistente de IA y no puedo enviar ayuda. Si no es una emergencia, con gusto le ayudo.`,
  fr: (n) =>
    `Si quelqu'un est en danger ou s'il s'agit d'une urgence médicale, raccrochez et appelez le ${n} immédiatement. Je suis une IA et je ne peux pas envoyer de secours. Si ce n'est pas une urgence, je reste à votre disposition.`,
  de: (n) =>
    `Wenn jemand in Gefahr ist oder es sich um einen medizinischen Notfall handelt, legen Sie bitte auf und rufen Sie sofort die ${n} an. Ich bin eine KI und kann keine Hilfe schicken. Wenn es kein Notfall ist, helfe ich Ihnen gern.`,
  zh: (n) =>
    `如果有人身处危险或这是医疗紧急情况，请立即挂断并拨打${n}。我是人工智能助理，无法派遣救援。如果不是紧急情况，我很乐意为您提供帮助。`,
  ar: (n) =>
    `إذا كان أحد في خطر أو كانت هذه حالة طبية طارئة، يرجى إنهاء المكالمة والاتصال بالرقم ${n} فوراً. أنا مساعد ذكاء اصطناعي ولا أستطيع إرسال المساعدة. إن لم تكن حالة طارئة، يسعدني مساعدتك.`,
};

export function emergencyMessage(lang: Lang, number: string): string {
  return EMERGENCY[lang](number);
}

const TROUBLE: Record<Lang, string> = {
  en: "I'm sorry, I'm having a technical problem right now. Could I take your name and number so someone can call you back?",
  es: "Lo siento, ahora mismo tengo un problema técnico. ¿Me deja su nombre y número para que alguien le devuelva la llamada?",
  fr: "Toutes mes excuses, je rencontre un problème technique. Puis-je prendre votre nom et votre numéro pour qu'on vous rappelle ?",
  de: "Entschuldigung, ich habe gerade ein technisches Problem. Darf ich Ihren Namen und Ihre Nummer notieren, damit Sie zurückgerufen werden?",
  zh: "抱歉，我这边暂时出现了技术问题。可以留下您的姓名和电话号码，让同事给您回电吗？",
  ar: "عذراً، أواجه مشكلة تقنية الآن. هل يمكنني أخذ اسمك ورقمك ليتصل بك أحد الزملاء؟",
};

export function troubleMessage(lang: Lang): string {
  return TROUBLE[lang];
}

/** Life-threatening emergency phrases (not business "emergencies" like a burst pipe). */
const EMERGENCY_PATTERNS: RegExp[] = [
  /\b(heart attack|can'?t breathe|cannot breathe|not breathing|unconscious|overdos(e|ed)|stroke|choking|severe(ly)? bleeding|bleeding (heavily|a lot)|suicid(e|al)|kill (myself|himself|herself)|want to die|end my life|someone (is )?(attacking|has a (knife|gun))|house is on fire|on fire|gas leak)\b/i,
  /\b(ataque al coraz[oó]n|no puede respirar|no puedo respirar|inconsciente|sobredosis|suicid|quiero morir|me quiero matar)\b/i,
  /\b(crise cardiaque|ne respire plus|je ne peux pas respirer|inconscient|overdose|suicid|je veux mourir)\b/i,
  /\b(herzinfarkt|keine luft|atmet nicht|bewusstlos|[uü]berdosis|suizid|selbstmord|will sterben|ich bringe mich um)\b/i,
  /(心脏病发作|不能呼吸|无法呼吸|昏迷|失去知觉|服药过量|自杀|想死|着火了)/,
  /(نوبة قلبية|لا أستطيع التنفس|لا يتنفس|فاقد الوعي|جرعة زائدة|انتحار|أريد أن أموت)/,
];

export function looksLikeLifeThreateningEmergency(text: string): boolean {
  return EMERGENCY_PATTERNS.some((re) => re.test(text));
}

/** Ring the team first (ADR 0025): said before the team's phones and browsers ring. */
const TRY_TEAM: Record<Lang, string> = {
  en: "Let me try the team for you. One moment.",
  es: "Voy a intentar pasarle con el equipo. Un momento.",
  fr: "Je vais essayer de vous passer l'équipe. Un instant.",
  de: "Ich versuche, Sie mit dem Team zu verbinden. Einen Moment.",
  zh: "我帮您转接团队，请稍等。",
  ar: "سأحاول تحويلك إلى الفريق. لحظة من فضلك.",
};

export function tryTeamPhrase(lang: Lang): string {
  return TRY_TEAM[lang];
}

/** Nobody picked up when the team was rung first: the assistant carries on. */
const RING_FIRST_MISSED: Record<Lang, string> = {
  en: "Sorry, nobody from the team is free right now, but I can help: I can book you in, arrange a call back or take a message. What would you like?",
  es: "Lo siento, ahora mismo no hay nadie del equipo disponible, pero puedo ayudarle: darle una cita, programar una llamada o tomar un mensaje. ¿Qué prefiere?",
  fr: "Désolé, personne de l'équipe n'est disponible pour le moment, mais je peux vous aider : vous donner un rendez-vous, organiser un rappel ou prendre un message. Que préférez-vous ?",
  de: "Leider ist gerade niemand aus dem Team frei, aber ich kann helfen: einen Termin vereinbaren, einen Rückruf einplanen oder eine Nachricht aufnehmen. Was möchten Sie?",
  zh: "抱歉，团队现在没有人有空，不过我可以帮您：预约、安排回电或留言。您需要哪一种？",
  ar: "عذراً، لا يوجد أحد من الفريق متاح الآن، لكن يمكنني المساعدة: حجز موعد أو ترتيب معاودة الاتصال أو تسجيل رسالة. ماذا تفضل؟",
};

export function ringFirstMissedPhrase(lang: Lang): string {
  return RING_FIRST_MISSED[lang];
}
