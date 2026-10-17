import { LANGUAGE_NAMES, LANGUAGES, type Lang } from "../src/languages";

/**
 * Golden conversations: every flow in every supported language (brief §7). The caller is
 * simulated by a model following a goal and a set of facts, so the conversation adapts
 * to the order the agent asks questions in.
 */

export type Flow = "enquiry" | "complaint" | "booking" | "message" | "convert";

export interface Scenario {
  id: string;
  flow: Flow;
  language: Lang;
  style: "chat" | "voice";
  callerPhone: string | null;
  goal: string;
  facts: Record<string, string>;
  /** Record the agent must create (enquiries create none). */
  expectRecord: "ticket" | "booking" | "message" | null;
  /** For enquiries: a fact the answer must contain (checked as a substring of digits/words). */
  expectMention?: string;
}

const NAMES: Record<Lang, string> = {
  en: "Sam Patel",
  es: "Lucía Fernández",
  fr: "Camille Martin",
  de: "Jonas Becker",
  zh: "王丽",
  ar: "أحمد حسن",
};

const TEMPLATES: Record<Flow, (lang: Lang) => Omit<Scenario, "id" | "language" | "style">> = {
  enquiry: () => ({
    flow: "enquiry",
    callerPhone: null,
    goal: "Find out how much a check-up costs and whether there is parking nearby. You do not want to book today.",
    facts: {},
    expectRecord: null,
    expectMention: "45",
  }),
  complaint: (lang) => ({
    flow: "complaint",
    callerPhone: "+447700900123",
    goal: "Complain that a filling you had done last week fell out, and get it logged so someone calls you back.",
    facts: {
      name: NAMES[lang],
      "when it happened": "last Saturday",
      "how long": "four days now",
      impact: "it hurts when eating, quite painful",
      "already tried": "rinsing with salt water",
      "what you want": "to have it redone free of charge",
      "callback number": "the number you're calling from (07700 900123) is fine",
      "best time": "weekday mornings",
      "contact by SMS/email": "yes, SMS is fine",
      email: "you don't want to give an email",
    },
    expectRecord: "ticket",
  }),
  booking: (lang) => ({
    flow: "booking",
    callerPhone: null,
    goal: "Book a check-up tomorrow (Tuesday) morning. Accept the first time offered.",
    facts: { name: NAMES[lang], phone: "07700 900456", email: "you'd rather not give one" },
    expectRecord: "booking",
  }),
  convert: (lang) => ({
    flow: "convert",
    callerPhone: null,
    goal: "You've just moved to the area and are looking for a new dentist for yourself and your 6-year-old. Ask what they offer, whether they see children, and whether there's evening availability. Also ask whether they accept a specific insurer called 'Medisure' (you don't know if they do). If the answers sound good, book a check-up for yourself next Tuesday morning. Do NOT ask for a callback or for a human.",
    facts: { name: NAMES[lang], phone: "07700 900321", email: "you'd rather not give one" },
    expectRecord: "booking",
  }),
  message: (lang) => ({
    flow: "message",
    callerPhone: null,
    goal: "Leave a message for the practice manager asking them to call you back about an invoice you think is wrong.",
    facts: {
      name: NAMES[lang],
      phone: "07700 900789",
      urgency: "not urgent, normal",
      "best time": "after 3pm",
    },
    expectRecord: "message",
  }),
};

export const SCENARIOS: Scenario[] = (Object.keys(TEMPLATES) as Flow[]).flatMap((flow, f) =>
  LANGUAGES.map((language, l) => ({
    id: `${flow}-${language}`,
    language,
    // Alternate chat/voice so both style rule sets are exercised.
    style: (f + l) % 2 === 0 ? ("chat" as const) : ("voice" as const),
    ...TEMPLATES[flow](language),
  })),
);

export function simulatorPrompt(s: Scenario, business: string): string {
  const facts = Object.entries(s.facts)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  return `You are role-playing a customer contacting ${business} (a dental practice). You are talking to their AI assistant.
Speak ONLY ${LANGUAGE_NAMES[s.language]}, naturally, like a real person: short replies, one or two sentences.
Your goal: ${s.goal}
Facts you know (share them when asked or when natural; don't dump them all at once):
${facts || "- (none needed)"}
If the assistant reads something back correctly, confirm it. If something is wrong, correct it.
When your goal is done and the assistant asks if there's anything else, say goodbye and add [END] at the very end.
Never act as the assistant, and never write stage directions.`;
}
