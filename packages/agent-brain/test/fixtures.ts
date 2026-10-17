import type { AgentContext } from "../src/context";
import { PERSONAS } from "../src/personas";
import { emptyProfile, type BusinessProfile } from "../src/profile";

export const PROFILE: BusinessProfile = {
  ...emptyProfile("Bright Dental"),
  summary: "Friendly family dental practice in Camden, London.",
  services: [
    {
      name: "Check-up",
      description: "Routine dental examination",
      price: "£45",
      durationMinutes: 30,
      bookable: true,
      sourceUrl: null,
    },
    {
      name: "Hygiene clean",
      description: null,
      price: "£60",
      durationMinutes: 45,
      bookable: true,
      sourceUrl: null,
    },
    {
      name: "Whitening",
      description: "Consultation required first",
      price: "from £250",
      durationMinutes: null,
      bookable: false,
      sourceUrl: null,
    },
  ],
  openingHours: emptyProfile("x").openingHours.map((h) =>
    h.day === "sat" || h.day === "sun"
      ? { ...h, closed: true }
      : { ...h, open: "09:00", close: "17:00" },
  ),
  location: {
    address: "12 High Street, London NW1 7AA",
    area: "Camden",
    directions: null,
    parking: "No parking on site",
  },
  contact: { phone: "020 7946 0958", email: "hello@bright.example", website: null },
  bookingRules: {
    minNoticeHours: 2,
    bufferMinutes: 0,
    cancellationPolicy: "24 hours notice please",
  },
};

/** Monday 19 October 2026, 09:00 in London (UTC+1). */
export const NOW = new Date("2026-10-19T08:00:00Z");

export function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    businessName: "Bright Dental",
    countryCode: "GB",
    timezone: "Europe/London",
    defaultLanguage: "en",
    persona: PERSONAS.amelia,
    personaName: "Amelia",
    profile: PROFILE,
    style: "chat",
    emergencyNumber: "999",
    now: () => NOW,
    ...overrides,
  };
}
