import type { CountryConfig } from "./types";

/** United States (Wave 1, ADR 0031). Engineering defaults pending legal review. */
export const us: CountryConfig = {
  code: "US",
  name: "United States",
  status: "preview",
  currency: "USD",
  locale: "en-US",
  timezones: [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
  ],
  // Pay-per-call (900) and 976 services.
  premiumPrefixes: ["+1900", "+1976"],
  emergencyNumbers: ["911"],

  recording: {
    // Several states require every party to consent; for all-party countries the spoken
    // notice adds that staying on the line means agreeing.
    consentModel: "all-party",
    needsLegalReview: true,
  },

  aiDisclosure: {
    required: true,
    basis: "Platform policy; the FCC treats AI-generated voices as artificial voices (TCPA).",
  },

  outbound: {
    // TCPA: 8am to 9pm in the callee's local time (we use the business time zone; ADR 0031).
    weekdays: { start: "08:00", end: "21:00" },
    saturday: { start: "09:00", end: "17:00" },
    sunday: null,
    doNotCallRegister: { name: "National Do Not Call Registry", requiredForMarketing: true },
    // AI-voice calls need prior express consent: only callbacks the customer asked for.
    aiCalls: { callbacks: true, confirmations: false },
    needsLegalReview: true,
  },

  // A2P 10DLC: business texts from local numbers are blocked until the brand is registered.
  sms: { registration: "10dlc" },

  marketing: {
    electronicMarketingRequiresConsent: true, // TCPA for texts
    softOptInAllowed: false,
  },

  numbers: { localNumberRequiresRegulatoryBundle: false, needsLegalReview: true },

  defaultDataRegion: "us",
};
