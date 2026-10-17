import type { Lang } from "./languages";
import type { Persona } from "./personas";
import type { BusinessProfile } from "./profile";

/** Everything the agent needs to know about where it is working. Stable per conversation. */
export interface AgentContext {
  businessName: string;
  countryCode: string;
  timezone: string;
  defaultLanguage: Lang;
  persona: Persona;
  /** Display name (businesses can rename personas). */
  personaName: string;
  /** Approved profile, or null when nothing is approved yet. */
  profile: BusinessProfile | null;
  /** "voice": spoken-style rules; "chat": short written replies. */
  style: "chat" | "voice";
  /** Local emergency number to direct callers to (999 in the UK). */
  emergencyNumber: string;
  now: () => Date;
}
