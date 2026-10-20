import { localDateString } from "./availability";
import type { BusinessProfile } from "./profile";

/**
 * Who a phone caller asking for a person (or describing an urgent situation) is put through
 * to (Phase 3, ADR 0015). Pure, so the rules are tested as a table.
 */

export interface TransferSettings {
  transferPhone: string | null;
  /** "open": only during opening hours; "always": any time. */
  transferHours: "open" | "always";
  /** Out-of-hours number for urgent situations only. */
  onCallPhone: string | null;
}

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Whether the business is open right now by its approved opening hours (unknown = closed). */
export function isOpenNow(profile: BusinessProfile | null, timeZone: string, now: Date): boolean {
  if (!profile) return false;
  const date = localDateString(now, timeZone);
  const [y, m, d] = date.split("-").map(Number);
  const day = WEEKDAYS[(new Date(Date.UTC(y!, m! - 1, d)).getUTCDay() + 6) % 7]!;
  const hours = profile.openingHours.find((h) => h.day === day);
  if (!hours || hours.closed || !hours.open || !hours.close) return false;
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return time >= hours.open && time < hours.close;
}

/** The number to transfer to, or null (then the assistant takes a message instead). */
export function transferTarget(
  settings: TransferSettings,
  openNow: boolean,
  urgent: boolean,
): string | null {
  const normalHoursOk = settings.transferHours === "always" || openNow;
  if (settings.transferPhone && normalHoursOk) return settings.transferPhone;
  // Urgent situations reach someone even when the normal line isn't available.
  if (urgent && settings.onCallPhone) return settings.onCallPhone;
  return null;
}

/** `transfer.to` value meaning "a person at the VA console" rather than a phone number. */
export const PEOPLE_TARGET = "people";

export type HandoffRoute = "people_then_phone" | "people_only" | "phone_only";

export function toHandoffRoute(value: string | null | undefined): HandoffRoute {
  return value === "people_only" || value === "phone_only" ? value : "people_then_phone";
}

/**
 * Where a phone caller asking for a person goes (Phase 5, ADR 0018): someone at the VA console
 * when the route allows it and someone is available (with the phone number as fallback if
 * nobody answers), else the phone number, else nobody (the assistant takes a message).
 */
export function handoffPlan(
  route: HandoffRoute,
  peopleAvailable: boolean,
  phone: string | null,
): { to: string; fallback?: string } | null {
  if (route !== "phone_only" && peopleAvailable) {
    return route === "people_then_phone" && phone
      ? { to: PEOPLE_TARGET, fallback: phone }
      : { to: PEOPLE_TARGET };
  }
  if (route !== "people_only" && phone) return { to: phone };
  return null;
}
