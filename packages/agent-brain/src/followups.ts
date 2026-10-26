import { localDateString, zonedToUtc } from "./availability";
import type { BusinessProfile } from "./profile";
import { isOpenNow } from "./transfer";

/**
 * Follow-ups (ADR 0026): one message the morning after an enquiry that didn't book, only
 * when the customer agreed in the conversation (PECR: it's marketing). Pure helpers here;
 * scheduling is the assistant's schedule_follow_up tool, sending is the workers' tick.
 */

export type FollowUpChannel = "sms" | "email" | "whatsapp";

/** Meta only allows free-form WhatsApp messages within 24 h of the customer's last one. */
export const WHATSAPP_WINDOW_MS = 23 * 3_600_000;
/** A booking this soon after a follow-up counts as won by it. */
export const ATTRIBUTION_MS = 7 * 86_400_000;
const SEND_TIME = "10:00";

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * When to send: 10:00 local on the next day the business is open (by its approved hours;
 * tomorrow when hours aren't known). WhatsApp stays inside Meta's 24-hour window.
 */
export function followUpSendAt(
  now: Date,
  timeZone: string,
  profile: BusinessProfile | null,
  channel: FollowUpChannel,
): Date {
  const today = localDateString(now, timeZone);
  let when = zonedToUtc(shiftDate(today, 1), SEND_TIME, timeZone);
  if (profile?.openingHours.length) {
    for (let day = 1; day <= 7; day++) {
      const candidate = zonedToUtc(shiftDate(today, day), SEND_TIME, timeZone);
      if (isOpenNow(profile, timeZone, candidate)) {
        when = candidate;
        break;
      }
    }
  }
  if (channel === "whatsapp") {
    const latest = new Date(now.getTime() + WHATSAPP_WINDOW_MS);
    if (when > latest) when = latest;
  }
  return when;
}

/** What they asked about, safe to put in a message: no links, numbers or markup, ≤ 60 chars. */
export function cleanTopic(topic: string): string {
  return topic
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/[\d<>{}[\]\\|@#*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
}

/** The stable prompt rule (only when the business has follow-ups on). */
export const FOLLOW_UP_RULE =
  'Follow-ups: when an enquiry ends without a booking, you may offer once to send one message tomorrow with times to book (for example "Would you like me to send you a message tomorrow with some times?"). Only call schedule_follow_up after the customer clearly says yes, with the number or email they confirm. Never offer it twice, and never after they booked.';
