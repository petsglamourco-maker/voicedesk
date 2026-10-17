import { z } from "zod";

/**
 * The business profile: admin-approved facts the agent always has in context (ADR 0011).
 * Kept JSON-Schema friendly (no min/max constraints) so it can drive structured output.
 * `null` means "not known" — the agent must never fill gaps itself.
 */

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const nullableString = z.string().nullable();

export const serviceSchema = z.strictObject({
  name: z.string(),
  description: nullableString,
  /** Price exactly as published, with currency, e.g. "£45" or "from £250". */
  price: nullableString,
  durationMinutes: z.number().nullable(),
  /** Whether customers can book this service directly. */
  bookable: z.boolean(),
  sourceUrl: nullableString,
});

export const openingHoursSchema = z.strictObject({
  day: z.enum(WEEKDAYS),
  closed: z.boolean(),
  /** 24h "HH:MM" local time; null when closed or unknown. */
  open: nullableString,
  close: nullableString,
});

export const businessProfileSchema = z.strictObject({
  businessName: z.string(),
  /** One or two sentences describing what the business does. */
  summary: z.string(),
  services: z.array(serviceSchema),
  openingHours: z.array(openingHoursSchema),
  hoursNotes: nullableString,
  location: z.strictObject({
    address: nullableString,
    area: nullableString,
    directions: nullableString,
    parking: nullableString,
  }),
  contact: z.strictObject({
    phone: nullableString,
    email: nullableString,
    website: nullableString,
  }),
  policies: z.array(
    z.strictObject({ topic: z.string(), details: z.string(), sourceUrl: nullableString }),
  ),
  faqs: z.array(
    z.strictObject({ question: z.string(), answer: z.string(), sourceUrl: nullableString }),
  ),
  staff: z.array(z.strictObject({ name: z.string(), role: nullableString })),
  bookingRules: z.strictObject({
    /** Minimum notice for a booking, in hours. */
    minNoticeHours: z.number().nullable(),
    /** Gap kept between appointments, in minutes. */
    bufferMinutes: z.number().nullable(),
    cancellationPolicy: nullableString,
  }),
});

export type BusinessProfile = z.infer<typeof businessProfileSchema>;
export type Service = z.infer<typeof serviceSchema>;

export function emptyProfile(businessName: string): BusinessProfile {
  return {
    businessName,
    summary: "",
    services: [],
    openingHours: WEEKDAYS.map((day) => ({ day, closed: false, open: null, close: null })),
    hoursNotes: null,
    location: { address: null, area: null, directions: null, parking: null },
    contact: { phone: null, email: null, website: null },
    policies: [],
    faqs: [],
    staff: [],
    bookingRules: { minNoticeHours: null, bufferMinutes: null, cancellationPolicy: null },
  };
}

/** JSON Schema for structured output (the API rejects unknown keywords like $schema). */
export function profileJsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(businessProfileSchema, { io: "output" });
  return schema;
}

const DAY_NAMES: Record<(typeof WEEKDAYS)[number], string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/** Renders the profile as compact text for the agent's system prompt. */
export function formatProfileForPrompt(p: BusinessProfile): string {
  const lines: string[] = [`Business: ${p.businessName}`];
  if (p.summary) lines.push(`About: ${p.summary}`);
  const hours = p.openingHours
    .map((h) =>
      h.closed
        ? `${DAY_NAMES[h.day]}: closed`
        : h.open && h.close
          ? `${DAY_NAMES[h.day]}: ${h.open}-${h.close}`
          : `${DAY_NAMES[h.day]}: unknown`,
    )
    .join("; ");
  lines.push(`Opening hours: ${hours}`);
  if (p.hoursNotes) lines.push(`Hours notes: ${p.hoursNotes}`);
  if (p.services.length) {
    lines.push("Services:");
    for (const s of p.services) {
      const bits = [
        s.price ? `price ${s.price}` : "price not published",
        s.durationMinutes ? `${s.durationMinutes} min` : null,
        s.bookable ? "bookable" : "not bookable directly",
      ].filter(Boolean);
      lines.push(`- ${s.name}${s.description ? `: ${s.description}` : ""} (${bits.join(", ")})`);
    }
  }
  const loc = p.location;
  for (const [label, value] of [
    ["Address", loc.address],
    ["Area", loc.area],
    ["Directions", loc.directions],
    ["Parking", loc.parking],
    ["Phone", p.contact.phone],
    ["Email", p.contact.email],
    ["Website", p.contact.website],
  ] as const) {
    if (value) lines.push(`${label}: ${value}`);
  }
  if (p.policies.length) {
    lines.push("Policies:");
    for (const pol of p.policies) lines.push(`- ${pol.topic}: ${pol.details}`);
  }
  const rules = p.bookingRules;
  if (rules.cancellationPolicy) lines.push(`Cancellation policy: ${rules.cancellationPolicy}`);
  if (rules.minNoticeHours) lines.push(`Minimum booking notice: ${rules.minNoticeHours} hours`);
  if (p.staff.length) {
    lines.push(
      `Staff: ${p.staff.map((s) => (s.role ? `${s.name} (${s.role})` : s.name)).join(", ")}`,
    );
  }
  if (p.faqs.length) {
    lines.push("FAQs:");
    for (const f of p.faqs) lines.push(`- Q: ${f.question} A: ${f.answer}`);
  }
  return lines.join("\n");
}
