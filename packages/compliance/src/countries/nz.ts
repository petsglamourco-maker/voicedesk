import type { CountryConfig } from "./types";

/** New Zealand (Wave 1, ADR 0031). Engineering defaults pending legal review. */
export const nz: CountryConfig = {
  code: "NZ",
  name: "New Zealand",
  status: "preview",
  currency: "NZD",
  locale: "en-NZ",
  timezones: ["Pacific/Auckland", "Pacific/Chatham"],
  // Premium 0900 services.
  premiumPrefixes: ["+64900"],
  emergencyNumbers: ["111"],

  recording: {
    // One-party consent law; we always give notice anyway.
    consentModel: "notice",
    needsLegalReview: true,
  },

  aiDisclosure: {
    required: true,
    basis: "Platform policy; Fair Trading Act (misleading conduct).",
  },

  outbound: {
    // No statutory hours: conservative defaults.
    weekdays: { start: "09:00", end: "20:00" },
    saturday: { start: "09:00", end: "17:00" },
    sunday: null,
    doNotCallRegister: null,
    aiCalls: { callbacks: true, confirmations: true },
    needsLegalReview: true,
  },

  sms: { registration: null },

  marketing: {
    electronicMarketingRequiresConsent: true, // Unsolicited Electronic Messages Act 2007
    softOptInAllowed: true, // inferred consent
  },

  numbers: { localNumberRequiresRegulatoryBundle: false, needsLegalReview: true },

  defaultDataRegion: "us",
};
