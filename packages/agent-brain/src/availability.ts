import { WEEKDAYS, type BusinessProfile } from "./profile";

/**
 * Native availability from the approved profile (opening hours, service duration, buffer,
 * minimum notice) minus existing bookings. External calendars join in Phase 3.
 */

export interface BusyRange {
  startsAt: Date;
  endsAt: Date;
}

export interface Slot {
  startsAt: string; // ISO (UTC)
  local: string; // "Tuesday 14 October, 10:30" in the business time zone
}

/** Offset (ms) of a time zone from UTC at a given instant. */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - instant.getTime();
}

/** Converts a local wall-clock date + "HH:MM" in a time zone to a UTC Date. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y!, m! - 1, d, hh, mm);
  const first = guess - tzOffsetMs(new Date(guess), timeZone);
  // Re-check once to handle DST boundaries.
  return new Date(guess - tzOffsetMs(new Date(first), timeZone));
}

export function localDateString(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function formatLocal(instant: Date, timeZone: string, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(instant);
}

function weekdayOf(date: string): (typeof WEEKDAYS)[number] {
  const [y, m, d] = date.split("-").map(Number);
  const js = new Date(Date.UTC(y!, m! - 1, d)).getUTCDay(); // 0 = Sunday
  return WEEKDAYS[(js + 6) % 7]!;
}

export interface AvailabilityQuery {
  profile: BusinessProfile;
  timeZone: string;
  date: string; // YYYY-MM-DD local
  serviceName: string;
  timeOfDay?: "morning" | "afternoon" | "evening" | "any";
  busy: BusyRange[];
  now: Date;
  max?: number;
  stepMinutes?: number;
}

export type AvailabilityResult =
  { ok: true; durationMinutes: number; slots: Slot[] } | { ok: false; reason: string };

export function findSlots(q: AvailabilityQuery): AvailabilityResult {
  const service = q.profile.services.find(
    (s) => s.name.toLowerCase() === q.serviceName.toLowerCase(),
  );
  if (!service) {
    const names = q.profile.services.filter((s) => s.bookable).map((s) => s.name);
    return {
      ok: false,
      reason: `Unknown service. Bookable services: ${names.join(", ") || "none"}`,
    };
  }
  if (!service.bookable) return { ok: false, reason: `${service.name} cannot be booked directly` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.date)) return { ok: false, reason: "date must be YYYY-MM-DD" };

  const hours = q.profile.openingHours.find((h) => h.day === weekdayOf(q.date));
  if (!hours || hours.closed) return { ok: false, reason: "The business is closed that day" };
  if (!hours.open || !hours.close)
    return { ok: false, reason: "Opening hours for that day are not known" };

  const duration = service.durationMinutes ?? 30;
  const buffer = q.profile.bookingRules.bufferMinutes ?? 0;
  const earliest = q.now.getTime() + (q.profile.bookingRules.minNoticeHours ?? 1) * 3_600_000;
  const open = zonedToUtc(q.date, hours.open, q.timeZone).getTime();
  const close = zonedToUtc(q.date, hours.close, q.timeZone).getTime();
  const step = (q.stepMinutes ?? 15) * 60_000;

  const candidates: Date[] = [];
  for (let t = open; t + duration * 60_000 <= close; t += step) {
    if (t < earliest) continue;
    const end = t + duration * 60_000;
    const clash = q.busy.some(
      (b) =>
        t < b.endsAt.getTime() + buffer * 60_000 && end + buffer * 60_000 > b.startsAt.getTime(),
    );
    if (clash) continue;
    const localHour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: q.timeZone,
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date(t)),
    );
    const part = localHour < 12 ? "morning" : localHour < 17 ? "afternoon" : "evening";
    if (q.timeOfDay && q.timeOfDay !== "any" && q.timeOfDay !== part) continue;
    candidates.push(new Date(t));
  }
  if (candidates.length === 0) return { ok: false, reason: "No free slots that day" };

  // Offer a spread across the window rather than three consecutive slots.
  const max = q.max ?? 3;
  const picks =
    candidates.length <= max
      ? candidates
      : Array.from(
          { length: max },
          (_, i) => candidates[Math.round((i * (candidates.length - 1)) / (max - 1))]!,
        );
  return {
    ok: true,
    durationMinutes: duration,
    slots: picks.map((d) => ({ startsAt: d.toISOString(), local: formatLocal(d, q.timeZone) })),
  };
}

/** Whether a specific start time is still free (re-checked at booking time). */
export function isSlotFree(
  q: Omit<AvailabilityQuery, "date" | "timeOfDay" | "max">,
  startsAt: Date,
): boolean {
  const date = localDateString(startsAt, q.timeZone);
  const result = findSlots({ ...q, date, max: 10_000, timeOfDay: "any", stepMinutes: 5 });
  return (
    result.ok && result.slots.some((s) => new Date(s.startsAt).getTime() === startsAt.getTime())
  );
}
