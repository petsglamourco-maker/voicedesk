import type { CountryConfig } from "./types";

/** Canada (Wave 1, ADR 0031). Engineering defaults pending legal review. */
export const ca: CountryConfig = {
  code: "CA",
  name: "Canada",
  status: "preview",
  currency: "CAD",
  locale: "en-CA",
  timezones: [
    "America/Toronto",
    "America/Vancouver",
    "America/Edmonton",
    "America/Winnipeg",
    "America/Regina",
    "America/Halifax",
    "America/St_Johns",
  ],
  premiumPrefixes: ["+1900", "+1976"],
  emergencyNumbers: ["911"],

  recording: {
    // The Criminal Code allows one-party consent; PIPEDA expects notice, which we always give.
    consentModel: "notice",
    needsLegalReview: true,
  },

  aiDisclosure: { required: true, basis: "Platform policy; consumer-protection fairness." },

  outbound: {
    // CRTC Unsolicited Telecommunications Rules.
    weekdays: { start: "09:00", end: "21:30" },
    saturday: { start: "10:00", end: "18:00" },
    sunday: null,
    doNotCallRegister: { name: "National Do Not Call List (DNCL)", requiredForMarketing: true },
    aiCalls: { callbacks: true, confirmations: false },
    needsLegalReview: true,
  },

  sms: { registration: null },

  marketing: {
    electronicMarketingRequiresConsent: true, // CASL
    softOptInAllowed: true, // implied consent within an existing business relationship
  },

  numbers: { localNumberRequiresRegulatoryBundle: false, needsLegalReview: true },

  defaultDataRegion: "us",
};
