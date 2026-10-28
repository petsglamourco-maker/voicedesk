import type { CountryConfig } from "./types";

/** Ireland (Wave 1, ADR 0031). Engineering defaults pending legal review. */
export const ie: CountryConfig = {
  code: "IE",
  name: "Ireland",
  status: "preview",
  currency: "EUR",
  locale: "en-IE",
  timezones: ["Europe/Dublin"],
  // Premium (15xx) and personal-number (0700) ranges.
  premiumPrefixes: ["+35315", "+353700"],
  emergencyNumbers: ["112", "999"],

  recording: {
    // GDPR transparency: a clear notice, which we always give when recording.
    consentModel: "notice",
    needsLegalReview: true,
  },

  aiDisclosure: {
    required: true,
    basis: "Platform policy; EU AI Act Art. 50 (people must be told they are talking to an AI).",
  },

  outbound: {
    weekdays: { start: "09:00", end: "20:00" },
    saturday: { start: "09:00", end: "17:00" },
    sunday: null,
    doNotCallRegister: {
      name: "National Directory Database (NDD) opt-out",
      requiredForMarketing: true,
    },
    aiCalls: { callbacks: true, confirmations: true },
    needsLegalReview: true,
  },

  sms: { registration: null },

  marketing: {
    electronicMarketingRequiresConsent: true, // ePrivacy Regulations (S.I. 336/2011)
    softOptInAllowed: true,
  },

  numbers: { localNumberRequiresRegulatoryBundle: true, needsLegalReview: true },

  defaultDataRegion: "eu",
};
