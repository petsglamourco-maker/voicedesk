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

export interface BookingInput {
  service: string;
  startsAt: Date;
  endsAt: Date;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  notes: string | null;
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
  createTicket(input: TicketInput): Promise<Created>;
  createBooking(input: BookingInput): Promise<Created>;
  takeMessage(input: MessageInput): Promise<Created>;
  /** Records a request for a person; `available` says whether live transfer is possible. */
  requestHuman(reason: string): Promise<Created & { available: boolean }>;
}

/** In-memory services for tests, evals and the simulated-call harness. */
export class InMemoryAgentServices implements AgentServices {
  readonly tickets: Array<TicketInput & Created> = [];
  readonly bookings: Array<BookingInput & Created> = [];
  readonly messages: Array<MessageInput & Created> = [];
  readonly humanRequests: Array<{ reason: string } & Created> = [];
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
        .filter((b) => b.startsAt < to && b.endsAt > from)
        .map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt })),
    );
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

  requestHuman(reason: string): Promise<Created & { available: boolean }> {
    const created = this.next("human");
    this.humanRequests.push({ reason, ...created });
    return Promise.resolve({ ...created, available: false });
  }
}
