/**
 * Per-country compliance configuration. Drives recording notices, AI disclosure wording,
 * calling hours, marketing rules and number regulations.
 *
 * Values marked `needsLegalReview: true` are engineering defaults, not legal advice — they
 * must be confirmed by a qualified adviser before go-live in that country.
 */

export type SupportedLanguage = "en" | "es" | "zh" | "fr" | "ar" | "de";

export interface CallingWindow {
  /** Local time, 24h "HH:MM". */
  start: string;
  end: string;
}

export interface CountryConfig {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  /** Numbers to direct callers to in a genuine emergency. The platform is never one. */
  emergencyNumbers: string[];

  recording: {
    /**
     * one-party: one participant's consent suffices; all-party: everyone must consent;
     * notice: lawful with a clear notice (GDPR transparency) — we always give notice anyway.
     */
    consentModel: "one-party" | "all-party" | "notice";
    needsLegalReview: boolean;
  };

  aiDisclosure: {
    /** Always true: disclosure cannot be switched off for any tenant or country. */
    required: true;
    /** Legal basis or rationale recorded for documentation. */
    basis: string;
  };

  outbound: {
    /** Default permitted windows for outbound calls in the callee's local time. */
    weekdays: CallingWindow;
    saturday: CallingWindow | null;
    sunday: CallingWindow | null;
    /** Screen marketing calls against the national do-not-call register. */
    doNotCallRegister: { name: string; requiredForMarketing: boolean } | null;
    needsLegalReview: boolean;
  };

  marketing: {
    /** Marketing SMS/email needs prior consent (soft opt-in may apply where noted). */
    electronicMarketingRequiresConsent: boolean;
    softOptInAllowed: boolean;
  };

  numbers: {
    /** Provider requires address/identity documents before issuing a local number. */
    localNumberRequiresRegulatoryBundle: boolean;
    needsLegalReview: boolean;
  };

  /** Default data residency region for tenants in this country. */
  defaultDataRegion: "uk" | "eu" | "us";
}
