/**
 * Agent personas (brief §3.3). Each keeps the same identity in every language; businesses
 * can rename them. Voice ids per language are added with TTS in Phase 2.
 */
export interface Persona {
  id: PersonaId;
  defaultName: string;
  gender: "female" | "male";
  /** Tone guidance for the system prompt. */
  style: string;
  bestFor: string;
}

export const PERSONAS = {
  amelia: {
    id: "amelia",
    defaultName: "Amelia",
    gender: "female",
    style: "Warm, calm and reassuring. Unhurried, kind, gently guiding the caller.",
    bestFor: "General reception (default)",
  },
  james: {
    id: "james",
    defaultName: "James",
    gender: "male",
    style: "Friendly, efficient and professional. Gets to the point while staying polite.",
    bestFor: "Busy front desks",
  },
  sofia: {
    id: "sofia",
    defaultName: "Sofia",
    gender: "female",
    style: "Bright and upbeat. Enthusiastic about helping and about the business's services.",
    bestFor: "Bookings and sales",
  },
  daniel: {
    id: "daniel",
    defaultName: "Daniel",
    gender: "male",
    style: "Composed and empathetic. Patient with upset callers, steady and reassuring.",
    bestFor: "Complaints and sensitive calls",
  },
} as const satisfies Record<string, Omit<Persona, "id"> & { id: string }>;

export type PersonaId = keyof typeof PERSONAS;
export const PERSONA_IDS = Object.keys(PERSONAS) as PersonaId[];

export function isPersonaId(value: unknown): value is PersonaId {
  return typeof value === "string" && value in PERSONAS;
}

export function getPersona(id: string): Persona {
  return isPersonaId(id) ? PERSONAS[id] : PERSONAS.amelia;
}
