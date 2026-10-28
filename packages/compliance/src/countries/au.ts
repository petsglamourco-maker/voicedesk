import type { CountryConfig } from "./types";

/** Australia (Wave 1, ADR 0031). Engineering defaults pending legal review. */
export const au: CountryConfig = {
  code: "AU",
  name: "Australia",
  status: "preview",
  currency: "AUD",
  locale: "en-AU",
  timezones: [
    "Australia/Sydney",
    "Australia/Melbourne",
    "Australia/Brisbane",
    "Australia/Adelaide",
    "Australia/Perth",
    "Australia/Hobart",
    "Australia/Darwin",
  ],
  // Premium 190x services.
  premiumPrefixes: ["+61190"],
  emergencyNumbers: ["000", "112"],

  recording: {
    // Some states require all parties to consent; the notice covers staying on the line.
    consentModel: "all-party",
    needsLegalReview: true,
  },

  aiDisclosure: {
    required: true,
    basis: "Platform policy; Australian Consumer Law (misleading or deceptive conduct).",
  },

  outbound: {
    // Telemarketing and Research Calls Industry Standard.
    weekdays: { start: "09:00", end: "20:00" },
    saturday: { start: "09:00", end: "17:00" },
    sunday: null,
    doNotCallRegister: { name: "Do Not Call Register (DNCR)", requiredForMarketing: true },
    aiCalls: { callbacks: true, confirmations: false },
    needsLegalReview: true,
  },

  sms: { registration: null },

  marketing: {
    electronicMarketingRequiresConsent: true, // Spam Act 2003
    softOptInAllowed: true, // inferred consent
  },

  numbers: { localNumberRequiresRegulatoryBundle: true, needsLegalReview: true },

  defaultDataRegion: "us",
};
