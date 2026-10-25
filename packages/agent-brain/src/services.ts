import type { BusyRange } from "./availability";
import type { ComplaintSlots, MessageSlots } from "./state";

/**
 * Side effects the agent can perform. The API implements this against the database
 * (services-db.ts); tests and the simulated-call harness use InMemoryAgentServices.
 */
export interface KnowledgeResult {
  content: string;
  title: string | null;
  url: string;
  score: number;
}

export interface TicketInput {
  details: Partial<ComplaintSlots>;
  summary: string;
  priority: "low" | "normal" | "high" | "urgent";
}

export interface BookingSummary {
  id: string;
  reference: string;
  service: string;
  startsAt: Date;
  endsAt: Date;
  customerName: string;
  customerPhone: string | null;
}

export interface BookingInput {
  service: string;
  startsAt: Date;
  endsAt: Date;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  notes: string | null;
}

export interface SignupInput {
  fullName: string;
  phone: string | null;
  email: string | null;
  interest: string;
  marketingConsent: boolean;
}

export type MessageInput = Pick<MessageSlots, "callerName" | "callerPhone" | "reason" | "urgency"> &
  Partial<Pick<MessageSlots, "forStaff" | "bestTime">>;

export interface Created {
  id: string;
  reference: string;
}

export interface AgentServices {
  searchKnowledge(query: string): Promise<KnowledgeResult[]>;
  /** Existing bookings overlapping [from, to). */
  listBusy(from: Date, to: Date): Promise<BusyRange[]>;
  /** Upcoming confirmed bookings by reference and/or customer phone (E.164). */
  findBookings(query: { reference?: string; phone?: string }): Promise<BookingSummary[]>;
  cancelBooking(bookingId: string): Promise<void>;
  rescheduleBooking(bookingId: string, startsAt: Date, endsAt: Date): Promise<void>;
  createTicket(input: TicketInput): Promise<Created>;
  createBooking(input: BookingInput): Promise<Created>;
  takeMessage(input: MessageInput): Promise<Created>;
  /** Records a request for a person; `available` says whether live transfer is possible. */
  requestHuman(
    reason: string,
    options?: { urgent?: boolean; departmentId?: string },
  ): Promise<
    Created & {
      available: boolean;
      /** A phone number, or PEOPLE_TARGET for the VA console. */
      transferTo?: string;
      /** Phone number to try if nobody at the console answers. */
      transferFallback?: string;
      handoff?: boolean;
    }
  >;
  /** Registers a new customer (lead / sign-up) taken by the assistant. */
  registerCustomer(input: SignupInput): Promise<Created>;
  /** Logs a question the assistant couldn't answer, so the business can fill the gap. */
  noteKnowledgeGap(question: string): Promise<void>;
  /** ADR 0025: saves the conversation's department ("keypad", "speech", "chat", "assistant"). */
  chooseDepartment?(departmentId: string, via: string): Promise<void>;
}

/** In-memory services for tests, evals and the simulated-call harness. */
export class InMemoryAgentServices implements AgentServices {
  readonly tickets: Array<TicketInput & Created> = [];
  readonly bookings: Array<BookingInput & Created & { status?: string }> = [];
  readonly messages: Array<MessageInput & Created> = [];
  readonly humanRequests: Array<{ reason: string } & Created> = [];
  readonly signups: Array<SignupInput & Created> = [];
  readonly knowledgeGaps: string[] = [];
  private counter = 0;

  constructor(private readonly knowledge: Array<{ title: string; content: string }> = []) {}

  private next(prefix: string): Created {
    this.counter++;
    return {
      id: `${prefix}-${this.counter}`,
      reference: `TS-${String(this.counter).padStart(4, "2")}`,
    };
  }

  searchKnowledge(query: string): Promise<KnowledgeResult[]> {
    const words = new Set(query.toLowerCase().match(/\p{L}{3,}/gu) ?? []);
    const scored = this.knowledge
      .map((k) => {
        const text = k.content.toLowerCase();
        const hits = [...words].filter((w) => text.includes(w)).length;
        return {
          content: k.content,
          title: k.title,
          url: `kb:${k.title}`,
          score: words.size ? hits / words.size : 0,
        };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
    return Promise.resolve(scored.slice(0, 4));
  }

  listBusy(from: Date, to: Date): Promise<BusyRange[]> {
    return Promise.resolve(
      this.bookings
        .filter((b) => b.status !== "cancelled" && b.startsAt < to && b.endsAt > from)
        .map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt })),
    );
  }

  findBookings(query: { reference?: string; phone?: string }): Promise<BookingSummary[]> {
    return Promise.resolve(
      this.bookings
        .filter(
          (b) =>
            b.status !== "cancelled" &&
            (!query.reference || b.reference.toUpperCase() === query.reference.toUpperCase()) &&
            (!query.phone || b.customerPhone === query.phone),
        )
        .map((b) => ({
          id: b.id,
          reference: b.reference,
          service: b.service,
          startsAt: b.startsAt,
          endsAt: b.endsAt,
          customerName: b.customerName,
          customerPhone: b.customerPhone,
        })),
    );
  }

  cancelBooking(bookingId: string): Promise<void> {
    const b = this.bookings.find((x) => x.id === bookingId);
    if (b) b.status = "cancelled";
    return Promise.resolve();
  }

  rescheduleBooking(bookingId: string, startsAt: Date, endsAt: Date): Promise<void> {
    const b = this.bookings.find((x) => x.id === bookingId);
    if (b) Object.assign(b, { startsAt, endsAt });
    return Promise.resolve();
  }

  createTicket(input: TicketInput): Promise<Created> {
    const created = this.next("ticket");
    this.tickets.push({ ...input, ...created });
    return Promise.resolve(created);
  }

  createBooking(input: BookingInput): Promise<Created> {
    const created = this.next("booking");
    this.bookings.push({ ...input, ...created });
    return Promise.resolve(created);
  }

  takeMessage(input: MessageInput): Promise<Created> {
    const created = this.next("message");
    this.messages.push({ ...input, ...created });
    return Promise.resolve(created);
  }

  registerCustomer(input: SignupInput): Promise<Created> {
    const created = this.next("signup");
    this.signups.push({ ...input, ...created });
    return Promise.resolve(created);
  }

  noteKnowledgeGap(question: string): Promise<void> {
    this.knowledgeGaps.push(question);
    return Promise.resolve();
  }

  readonly departmentChoices: Array<{ departmentId: string; via: string }> = [];

  chooseDepartment(departmentId: string, via: string): Promise<void> {
    this.departmentChoices.push({ departmentId, via });
    return Promise.resolve();
  }

  /** Set by tests to simulate a phone call where a transfer is possible. */
  transferTo: string | null = null;

  requestHuman(reason: string): Promise<Created & { available: boolean; transferTo?: string }> {
    const created = this.next("human");
    this.humanRequests.push({ reason, ...created });
    return Promise.resolve(
      this.transferTo
        ? { ...created, available: true, transferTo: this.transferTo }
        : { ...created, available: false },
    );
  }
}
