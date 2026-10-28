import type { CountryConfig } from "./types";

/** United Kingdom. First launch market. */
export const gb: CountryConfig = {
  code: "GB",
  name: "United Kingdom",
  status: "launched",
  currency: "GBP",
  locale: "en-GB",
  timezones: ["Europe/London"],
  // Premium (09), shared-cost (084, 087), personal (070), 0118 and 076 pager ranges.
  premiumPrefixes: ["+449", "+4487", "+4484", "+4470", "+44118", "+4476"],
  premiumExceptions: ["+447624"], // Isle of Man mobiles
  emergencyNumbers: ["999", "112"],

  recording: {
    // Businesses may record calls when callers are told (UK GDPR transparency; IPA 2016
    // lawful-business-practice regulations). We always play a notice when recording is on.
    consentModel: "notice",
    needsLegalReview: true,
  },

  aiDisclosure: {
    required: true,
    basis:
      "Platform policy (consumer trust, CMA/consumer protection on misleading practices); aligns with EU AI Act Art. 50 for EU callers.",
  },

  outbound: {
    // No statutory hours for live calls in the UK; conservative defaults aligned with
    // Ofcom persistent-misuse guidance and industry practice. Tenants may narrow, not widen.
    weekdays: { start: "08:00", end: "21:00" },
    saturday: { start: "09:00", end: "17:00" },
    sunday: null,
    doNotCallRegister: { name: "TPS / CTPS", requiredForMarketing: true },
    aiCalls: { callbacks: true, confirmations: true },
    needsLegalReview: true,
  },

  sms: { registration: null },

  marketing: {
    electronicMarketingRequiresConsent: true, // PECR
    softOptInAllowed: true, // PECR reg. 22(3), existing customers, similar products
  },

  numbers: {
    // Confirm against the telephony provider's current UK regulatory requirements (Phase 2).
    localNumberRequiresRegulatoryBundle: true,
    needsLegalReview: true,
  },

  defaultDataRegion: "uk",
};
