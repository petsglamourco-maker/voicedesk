import type { MenuSettings } from "./departments";
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
  /** "voice": spoken-style rules; "chat": short written replies; "email": full written replies. */
  style: "chat" | "voice" | "email";
  /** Local emergency number to direct callers to (999 in the UK). */
  emergencyNumber: string;
  /** Calls are recorded, so voice greetings add a recording notice. */
  recordCalls?: boolean;
  /** Per-persona TTS voice overrides (see voices.ts for the defaults). */
  voiceIds?: Record<string, string>;
  /** What counts as urgent for this business (phone transfers to the on-call number). */
  urgentSituations?: string | null;
  /**
   * No AI for this conversation (ADR 0022): "cap" when the business's monthly AI cap is
   * reached, "platform" when the platform owner paused AI. The engine takes messages instead.
   */
  aiPaused?: "cap" | "platform" | null;
  /** The business is suspended: only a fixed "not available" answer. */
  suspended?: boolean;
  /** Departments and the phone menu (ADR 0025). */
  menu?: MenuSettings;
  /** "backup": the business's main line forwards here when nobody answers. */
  callEntry?: "direct" | "backup";
  /** Ring the people who answer calls before the assistant takes over. */
  ringFirst?: boolean;
  /** ADR 0026: the assistant may offer one follow-up (setting on and in the plan). */
  followUps?: boolean;
  now: () => Date;
}
