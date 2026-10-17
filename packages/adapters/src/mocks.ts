// In-memory adapters for tests, local development and the simulated-call harness.
import { randomUUID } from "node:crypto";
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarProvider,
  TimeRange,
} from "./calendar/types";
import type { EmailMessage, EmailProvider } from "./email/types";
import type { EmbeddingProvider } from "./embeddings/types";
import type { LlmContentBlock, LlmProvider, LlmRequest, LlmResponse } from "./llm/types";
import type {
  SmsMessage,
  SmsProvider,
  WhatsAppProvider,
  WhatsAppTemplateMessage,
  WhatsAppTextMessage,
} from "./messaging/types";
import type {
  SpeechToTextProvider,
  TextToSpeechProvider,
  TranscriptionResult,
  Voice,
} from "./speech/types";
import type { ObjectStorage, PutObjectInput } from "./storage/types";
import type {
  AvailableNumber,
  NumberSearchQuery,
  ProvisionedNumber,
  TelephonyProvider,
} from "./telephony/types";

export class MockEmailProvider implements EmailProvider {
  readonly name = "mock-email";
  readonly sent: Array<EmailMessage & { id: string }> = [];

  send(message: EmailMessage): Promise<{ id: string }> {
    const id = randomUUID();
    this.sent.push({ ...message, id });
    return Promise.resolve({ id });
  }
}

export class InMemoryObjectStorage implements ObjectStorage {
  readonly name = "memory";
  private readonly objects = new Map<string, Uint8Array>();

  put(input: PutObjectInput): Promise<void> {
    const body = typeof input.body === "string" ? new TextEncoder().encode(input.body) : input.body;
    this.objects.set(input.key, body);
    return Promise.resolve();
  }

  get(key: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.objects.get(key) ?? null);
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  deletePrefix(prefix: string): Promise<number> {
    if (!prefix.endsWith("/")) throw new Error("deletePrefix: prefix must end with '/'");
    let deleted = 0;
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(prefix)) {
        this.objects.delete(key);
        deleted++;
      }
    }
    return Promise.resolve(deleted);
  }

  signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return Promise.resolve(`memory://${key}?expires=${expiresInSeconds}`);
  }
}

export class MockSmsProvider implements SmsProvider {
  readonly name = "mock-sms";
  readonly sent: Array<SmsMessage & { id: string }> = [];

  send(message: SmsMessage): Promise<{ id: string }> {
    const id = randomUUID();
    this.sent.push({ ...message, id });
    return Promise.resolve({ id });
  }
}

export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = "mock-whatsapp";
  readonly sent: Array<{
    senderId: string;
    message: WhatsAppTextMessage | WhatsAppTemplateMessage;
  }> = [];

  sendText(senderId: string, message: WhatsAppTextMessage): Promise<{ id: string }> {
    this.sent.push({ senderId, message });
    return Promise.resolve({ id: randomUUID() });
  }

  sendTemplate(senderId: string, message: WhatsAppTemplateMessage): Promise<{ id: string }> {
    this.sent.push({ senderId, message });
    return Promise.resolve({ id: randomUUID() });
  }
}

export class MockTelephonyProvider implements TelephonyProvider {
  readonly name = "mock-telephony";
  readonly purchased: ProvisionedNumber[] = [];

  searchNumbers(query: NumberSearchQuery): Promise<AvailableNumber[]> {
    const prefix = query.countryCode === "GB" ? "+44207946" : "+1555010";
    return Promise.resolve(
      Array.from({ length: query.limit ?? 3 }, (_, i) => ({
        e164: `${prefix}${String(i).padStart(4, "0")}`,
        requiresRegulatoryBundle: query.countryCode !== "GB",
      })),
    );
  }

  purchaseNumber(e164: string): Promise<ProvisionedNumber> {
    const number: ProvisionedNumber = { providerNumberId: randomUUID(), e164, status: "active" };
    this.purchased.push(number);
    return Promise.resolve(number);
  }

  releaseNumber(providerNumberId: string): Promise<void> {
    const index = this.purchased.findIndex((n) => n.providerNumberId === providerNumberId);
    if (index >= 0) this.purchased.splice(index, 1);
    return Promise.resolve();
  }
}

export type MockLlmResponder = (request: LlmRequest) => LlmResponse | undefined;

/**
 * Scriptable LLM. Answers from queued responses first, then from the responder function,
 * then echoes the last user message. Records every request for assertions.
 */
export class MockLlmProvider implements LlmProvider {
  readonly name = "mock-llm";
  readonly requests: LlmRequest[] = [];
  private readonly queue: LlmResponse[] = [];

  constructor(private readonly responder?: MockLlmResponder) {}

  enqueue(...responses: LlmResponse[]): this {
    this.queue.push(...responses);
    return this;
  }

  static response(content: LlmContentBlock[], stopReason: LlmResponse["stopReason"]): LlmResponse {
    return {
      content,
      raw: undefined,
      stopReason,
      usage: {
        model: "mock",
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      },
    };
  }

  static text(text: string): LlmResponse {
    return MockLlmProvider.response([{ type: "text", text }], "end_turn");
  }

  /** A response that calls one tool (optionally with leading text). */
  static toolUse(name: string, input: unknown, text?: string): LlmResponse {
    return MockLlmProvider.response(
      [
        ...(text ? [{ type: "text" as const, text }] : []),
        { type: "tool_use", id: `toolu_${randomUUID().slice(0, 8)}`, name, input },
      ],
      "tool_use",
    );
  }

  complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(structuredClone(request));
    const next = this.queue.shift() ?? this.responder?.(request);
    if (next) return Promise.resolve(next);
    const last = [...request.messages].reverse().find((m) => m.role === "user");
    const echo = typeof last?.content === "string" ? last.content : "";
    return Promise.resolve(MockLlmProvider.text(`(mock) ${echo}`));
  }

  async stream(request: LlmRequest, onText: (delta: string) => void): Promise<LlmResponse> {
    const response = await this.complete(request);
    for (const block of response.content) if (block.type === "text") onText(block.text);
    return response;
  }
}

/**
 * Deterministic embeddings for tests: hashed bag of words + character trigrams, so texts
 * sharing words land close together. Not semantically meaningful across languages.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock";
  readonly model = "mock-hash-384";
  readonly dimensions = 384;

  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((t) => this.vector(t)));
  }

  private vector(text: string): number[] {
    const v = new Array<number>(this.dimensions).fill(0);
    const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    const features = words.flatMap((w) => {
      const padded = `_${w}_`;
      const grams = [];
      for (let i = 0; i + 3 <= padded.length; i++) grams.push(padded.slice(i, i + 3));
      return [w, w, ...grams];
    });
    for (const f of features) {
      let h = 2166136261;
      for (let i = 0; i < f.length; i++) h = Math.imul(h ^ f.charCodeAt(i), 16777619);
      v[(h >>> 0) % this.dimensions]! += 1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}

export class MockSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = "mock-stt";
  constructor(private readonly result: TranscriptionResult = { text: "", language: "en" }) {}

  transcribe(): Promise<TranscriptionResult> {
    return Promise.resolve(this.result);
  }
}

export class MockTextToSpeechProvider implements TextToSpeechProvider {
  readonly name = "mock-tts";

  listVoices(): Promise<Voice[]> {
    return Promise.resolve([
      { id: "mock-female", name: "Mock Female", languages: ["en"], gender: "female" },
      { id: "mock-male", name: "Mock Male", languages: ["en"], gender: "male" },
    ]);
  }

  synthesize(text: string): Promise<{ audio: Uint8Array; mimeType: string }> {
    return Promise.resolve({ audio: new TextEncoder().encode(text), mimeType: "text/plain" });
  }
}

export class InMemoryCalendarProvider implements CalendarProvider {
  readonly name = "memory-calendar";
  private readonly events = new Map<string, Map<string, CalendarEvent>>();

  listCalendars(): Promise<Array<{ id: string; name: string; primary: boolean }>> {
    return Promise.resolve([
      { id: "primary", name: "Main calendar", primary: true },
      { id: "team", name: "Team diary", primary: false },
    ]);
  }

  private calendar(id: string): Map<string, CalendarEvent> {
    let cal = this.events.get(id);
    if (!cal) {
      cal = new Map<string, CalendarEvent>();
      this.events.set(id, cal);
    }
    return cal;
  }

  freeBusy(calendarIds: string[], window: TimeRange): Promise<TimeRange[]> {
    const busy = calendarIds
      .flatMap((id) => [...this.calendar(id).values()])
      .filter((e) => e.start < window.end && e.end > window.start)
      .map((e) => ({ start: e.start, end: e.end }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    return Promise.resolve(busy);
  }

  createEvent(calendarId: string, event: CalendarEventInput): Promise<CalendarEvent> {
    const created = { ...event, id: randomUUID() };
    this.calendar(calendarId).set(created.id, created);
    return Promise.resolve(created);
  }

  updateEvent(
    calendarId: string,
    eventId: string,
    patch: Partial<CalendarEventInput>,
  ): Promise<CalendarEvent> {
    const existing = this.calendar(calendarId).get(eventId);
    if (!existing) return Promise.reject(new Error(`event ${eventId} not found`));
    const updated = { ...existing, ...patch };
    this.calendar(calendarId).set(eventId, updated);
    return Promise.resolve(updated);
  }

  deleteEvent(calendarId: string, eventId: string): Promise<void> {
    this.calendar(calendarId).delete(eventId);
    return Promise.resolve();
  }
}
