import type { LlmMessage } from "@voicedesk/adapters";
import type { Lang } from "./languages";

/**
 * Conversation state machine (ADR 0009). The LLM fills slots through tools; this module
 * decides which steps are still required and refuses completion until they are done.
 */

export const INTENTS = [
  "enquiry",
  "signup",
  "complaint",
  "booking",
  "change_booking",
  "message",
  "human",
  "other",
] as const;
export type Intent = (typeof INTENTS)[number];
export type Flow = "opening" | Intent | "emergency";

export interface ComplaintSlots {
  callerName: string;
  issue: string;
  startedWhen: string;
  ongoingFor: string;
  impact: string;
  severity: "low" | "medium" | "high" | "critical";
  sentiment: "calm" | "frustrated" | "angry" | "distressed";
  alreadyTried: string;
  reference: string;
  preferredOutcome: string;
  callbackPhone: string;
  phoneConfirmed: boolean;
  email: string;
  emailConfirmed: boolean;
  callbackTime: string;
  contactConsent: boolean;
  /** Only when the customer asks to be called back are callback details collected. */
  wantsCallback: boolean;
}

export interface BookingSlots {
  service: string;
  startsAt: string; // ISO timestamp of the chosen slot
  customerName: string;
  phone: string;
  phoneConfirmed: boolean;
  email: string;
  notes: string;
}

/** Changing an existing booking: found (and verified) first, then cancelled or moved. */
export interface ChangeSlots {
  bookingId: string;
  reference: string;
  service: string;
  startsAt: string;
  endsAt: string;
  /** Failed lookups (wrong reference or details); capped to stop guessing. */
  failedLookups: number;
  /** Turn the booking was found (and read back): cancelling needs a later turn. */
  foundTurn: number;
  /** Turn new times were offered: moving needs a later turn (the caller picks and confirms). */
  slotsTurn: number;
}

export interface MessageSlots {
  callerName: string;
  callerPhone: string;
  phoneConfirmed: boolean;
  forStaff: string;
  reason: string;
  urgency: "low" | "normal" | "high";
  bestTime: string;
}

export interface SignupSlots {
  fullName: string;
  phone: string;
  phoneConfirmed: boolean;
  email: string;
  emailConfirmed: boolean;
  interest: string;
  marketingConsent: boolean;
}

export interface CreatedRecord {
  type:
    "ticket" | "booking" | "message" | "human_request" | "signup" | "cancellation" | "reschedule";
  reference: string;
  id: string;
}

export interface ConversationState {
  version: 1;
  language: Lang;
  flow: Flow;
  complaint: Partial<ComplaintSlots>;
  booking: Partial<BookingSlots>;
  message: Partial<MessageSlots>;
  signup: Partial<SignupSlots>;
  /** Optional: conversations saved before Phase 3 don't have it. */
  change?: Partial<ChangeSlots>;
  /** Caller ID from the channel, if known (offered back to the caller to confirm). */
  callerPhone: string | null;
  /** A returning customer recognised by their number (Phase 3). */
  knownCaller?: {
    name: string | null;
    upcoming: Array<{ reference: string; service: string; startsAt: string }>;
  };
  records: CreatedRecord[];
  /** Full LLM transcript (append-only, including tool calls and system notes). */
  history: LlmMessage[];
  turns: number;
  emergencyShown: boolean;
  /** The agent closed the conversation (end_conversation); phone calls hang up. */
  endRequested?: boolean;
  /** Phone calls: put the caller through to this number once the current reply is spoken. */
  transfer?: { to: string };
  /** Turn the last booking was made in (guards against a duplicate create in one turn). */
  lastBookingTurn?: number;
}

export function initialState(language: Lang, callerPhone: string | null = null): ConversationState {
  return {
    version: 1,
    language,
    flow: "opening",
    complaint: {},
    booking: {},
    message: {},
    signup: {},
    change: {},
    callerPhone,
    records: [],
    history: [],
    turns: 0,
    emergencyShown: false,
  };
}

const filled = (v: unknown) => v !== undefined && v !== null && v !== "";

/** Complaint steps in the order the agent should collect them (brief §3.4). */
export function missingComplaintSlots(c: Partial<ComplaintSlots>): string[] {
  const missing: string[] = [];
  if (!filled(c.callerName)) missing.push("callerName");
  if (!filled(c.issue)) missing.push("issue");
  if (!filled(c.startedWhen)) missing.push("startedWhen (when it started or was first noticed)");
  if (!filled(c.impact)) missing.push("impact (how it affects them / how serious)");
  if (!filled(c.severity)) missing.push("severity (your assessment)");
  if (!filled(c.preferredOutcome))
    missing.push("preferredOutcome (what they would like to happen)");
  if (filled(c.email) && !c.emailConfirmed) missing.push("emailConfirmed (spell the email back)");
  // Callback details only when the customer asked to be called back.
  if (c.wantsCallback) {
    if (!filled(c.callbackPhone)) missing.push("callbackPhone");
    else if (!c.phoneConfirmed) {
      missing.push("phoneConfirmed (read the number back and get a yes)");
    }
    if (!filled(c.callbackTime)) missing.push("callbackTime (best time to call back)");
    if (c.contactConsent === undefined) {
      missing.push("contactConsent (may we contact them by SMS/email about this issue?)");
    }
  }
  return missing;
}

export function missingSignupSlots(s: Partial<SignupSlots>): string[] {
  const missing: string[] = [];
  if (!filled(s.fullName)) missing.push("fullName");
  if (!filled(s.interest)) missing.push("interest (which service / programme)");
  if (!filled(s.phone) && !filled(s.email)) missing.push("phone or email");
  if (filled(s.phone) && !s.phoneConfirmed) {
    missing.push("phoneConfirmed (read the number back and get a yes)");
  }
  if (filled(s.email) && !s.emailConfirmed) missing.push("emailConfirmed (spell the email back)");
  if (s.marketingConsent === undefined) {
    missing.push("marketingConsent (may we send news and offers? yes or no, either is fine)");
  }
  return missing;
}

export function missingBookingSlots(b: Partial<BookingSlots>): string[] {
  const missing: string[] = [];
  if (!filled(b.service)) missing.push("service");
  if (!filled(b.startsAt))
    missing.push("startsAt (check availability, offer 2-3 slots, caller picks one)");
  if (!filled(b.customerName)) missing.push("customerName");
  if (!filled(b.phone)) missing.push("phone");
  else if (!b.phoneConfirmed) missing.push("phoneConfirmed (read the number back and get a yes)");
  return missing;
}

export function missingMessageSlots(m: Partial<MessageSlots>): string[] {
  const missing: string[] = [];
  if (!filled(m.callerName)) missing.push("callerName");
  if (!filled(m.callerPhone)) missing.push("callerPhone");
  else if (!m.phoneConfirmed) missing.push("phoneConfirmed (read the number back and get a yes)");
  if (!filled(m.reason)) missing.push("reason");
  if (!filled(m.urgency)) missing.push("urgency");
  if (!filled(m.bestTime)) missing.push("bestTime (best time to reach them)");
  return missing;
}

export function priorityFor(c: Partial<ComplaintSlots>): "low" | "normal" | "high" | "urgent" {
  if (c.severity === "critical" || c.sentiment === "distressed") return "urgent";
  if (c.severity === "high" || c.sentiment === "angry") return "high";
  if (c.severity === "low") return "low";
  return "normal";
}

/** After this many failed booking lookups the assistant stops (no guessing references). */
export const MAX_FAILED_LOOKUPS = 3;

/** Short operator note appended each turn: where we are and what is still needed. */
export type PrimaryGoal = "booking" | "signup" | "both";

const GOAL_TEXT: Record<PrimaryGoal, string> = {
  booking: "book an appointment",
  signup: "sign up (register_customer, or the sign-up link)",
  both: "book an appointment or sign up",
};

export function stepNote(
  state: ConversationState,
  now: string,
  goal: PrimaryGoal = "booking",
): string {
  const lines = [
    `[Engine note — not from the caller] Local time now: ${now}. Reply in language: ${state.language}.`,
  ];
  const done = (type: CreatedRecord["type"]) => state.records.find((r) => r.type === type);
  if (state.knownCaller && state.turns <= 2) {
    const k = state.knownCaller;
    const upcoming = k.upcoming
      .map((b) => `${b.service} ${b.reference} at ${b.startsAt}`)
      .join("; ");
    lines.push(
      `Returning customer (recognised by their phone number): ${k.name ?? "name not on file"}.${upcoming ? ` Upcoming bookings: ${upcoming}.` : ""} You may greet them by name. Still read back any detail before relying on it.`,
    );
  }
  switch (state.flow) {
    case "opening":
      lines.push(
        `Find out what the caller needs and call set_intent. Help them fully; where it fits their needs, guide them to ${GOAL_TEXT[goal]}.`,
      );
      break;
    case "complaint": {
      const ticket = done("ticket");
      if (ticket) {
        lines.push(
          `Complaint logged as ${ticket.reference}. Give the reference and say it's recorded for the business to review${state.complaint.wantsCallback ? " and that they'll call back at the agreed time" : ""}. Ask if there is anything else.`,
        );
        break;
      }
      const missing = missingComplaintSlots(state.complaint);
      lines.push(
        missing.length
          ? `Complaint flow. Still needed, one question at a time, in this order: ${missing.join("; ")}.`
          : "Complaint flow: all details captured. Summarise the complaint in one or two sentences, ask the caller to confirm, then call create_ticket.",
      );
      break;
    }
    case "booking": {
      const booking = state.records.findLast((r) => r.type === "booking");
      // Just booked, and no new booking started since.
      if (booking && !state.booking.service && !state.booking.startsAt) {
        lines.push(
          `Booked as ${booking.reference}. Confirm the date and time and the reference; ask if there is anything else (another booking is fine). Don't promise any contact from the team.`,
        );
        break;
      }
      const missing = missingBookingSlots(state.booking);
      lines.push(
        missing.length
          ? `Booking flow. Still needed: ${missing.join("; ")}.`
          : "Booking flow: all details captured. Read the booking back (service, day, time, name) and, once confirmed, call create_booking.",
      );
      break;
    }
    case "change_booking": {
      const c = state.change ?? {};
      const changed = done("cancellation") ?? done("reschedule");
      if (changed) {
        lines.push(
          `Booking ${changed.reference} ${changed.type === "cancellation" ? "cancelled" : "moved"}. Confirm what changed; ask if there is anything else.`,
        );
        break;
      }
      if ((c.failedLookups ?? 0) >= MAX_FAILED_LOOKUPS) {
        lines.push(
          "Change booking: the booking couldn't be verified. Don't try again or reveal anything about bookings; offer to take a message for the team instead.",
        );
        break;
      }
      lines.push(
        c.bookingId
          ? `Change booking: found ${c.reference} (${c.service}). Ask whether they want to cancel it or move it. To move it, check_availability for the new day, offer slots, read the change back, get a yes, then reschedule_booking. To cancel, read it back, get a yes, then cancel_booking.`
          : "Change booking: identify the booking first with find_booking: ask for the booking reference and the name it was booked under. On a phone call, find_booking with no reference uses the caller's number.",
      );
      break;
    }
    case "message": {
      const msg = done("message");
      if (msg) {
        lines.push(
          `Message taken as ${msg.reference}. Tell them it will be passed on; ask if there is anything else.`,
        );
        break;
      }
      const missing = missingMessageSlots(state.message);
      lines.push(
        missing.length
          ? `Message-taking flow. Still needed: ${missing.join("; ")}.`
          : "Message flow: all details captured. Read the message back and, once confirmed, call take_message.",
      );
      break;
    }
    case "signup": {
      const signup = done("signup");
      if (signup) {
        lines.push(
          `Signed up as ${signup.reference}. Explain the next steps from the profile (and the sign-up link if there is one); ask if there is anything else.`,
        );
        break;
      }
      const missing = missingSignupSlots(state.signup);
      lines.push(
        missing.length
          ? `Sign-up flow. Still needed: ${missing.join("; ")}.`
          : "Sign-up flow: all details captured. Read them back and, once confirmed, call register_customer.",
      );
      break;
    }
    case "human":
      lines.push("The caller wants a person. Call request_human, then follow its result.");
      break;
    case "emergency":
      lines.push(
        "Emergency guidance has been given. If the caller continues, help calmly with business matters only.",
      );
      break;
    default:
      lines.push(
        `Answer fully from the business profile, then search_knowledge (try another phrasing before giving up). Recommend what fits their needs and invite them to ${GOAL_TEXT[goal]}. Only take a message or arrange a callback if they ask for one.`,
      );
  }
  return lines.join("\n");
}
