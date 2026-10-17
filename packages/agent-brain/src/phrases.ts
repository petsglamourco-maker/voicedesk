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
    `مرحباً، معك ${a.business}. أنا ${a.name}، ${a.gender === "female" ? "المساعدة" : "المساعد"} الذكي المدعوم بالذكاء الاصطناعي. كيف يمكنني مساعدتك اليوم؟`,
};

export function greeting(lang: Lang, args: GreetingArgs): string {
  return GREETINGS[lang](args);
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

/** Spoken when a voice reply is slow (e.g. a lookup), so the caller isn't left in silence. */
const HOLD_ON: Record<Lang, string> = {
  en: "Just a moment.",
  es: "Un momento.",
  fr: "Un instant.",
  de: "Einen Moment.",
  zh: "请稍等。",
  ar: "لحظة من فضلك.",
};

export function holdOnPhrase(lang: Lang): string {
  return HOLD_ON[lang];
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
