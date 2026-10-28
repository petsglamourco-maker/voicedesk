// In-memory adapters for tests, local development and the simulated-call harness.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarProvider,
  TimeRange,
} from "./calendar/types";
import type { EmailMessage, EmailProvider } from "./email/types";
import type { EmbeddingProvider } from "./embeddings/types";
import type { HumanCheck } from "./human/types";
import {
  BillingSignatureError,
  type BillingEvent,
  type BillingProvider,
  type BillingSubscription,
} from "./billing/types";
import type { PushMessage, PushProvider, PushSubscriptionData } from "./push/types";
import type { VoiceTypingGrant, VoiceTypingProvider } from "./speech/types";
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
  CarrierNumbers,
  IdentityStatus,
  NumberIdentity,
  NumberIdentityDetails,
  NumberSearchQuery,
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

/** Carrier numbers for tests (ADR 0032): approve or reject reviews, mark numbers as taken. */
export class MockCarrierNumbers implements CarrierNumbers {
  readonly name = "mock-carrier-numbers";
  readonly identities = new Map<
    string,
    { details: NumberIdentityDetails; status: IdentityStatus }
  >();
  readonly bought: Array<{
    e164: string;
    identityId: string;
    voiceUrl: string;
    carrierNumberId: string;
  }> = [];
  readonly released: string[] = [];
  /** Numbers someone else bought since the search (buying them fails). */
  readonly taken = new Set<string>();

  searchAvailable(query: NumberSearchQuery): Promise<AvailableNumber[]> {
    const base = query.type === "mobile" ? "+447700900" : "+442382721";
    return Promise.resolve(
      Array.from({ length: query.limit ?? 5 }, (_, i) => {
        const e164 = `${base}${String(100 + i).padStart(3, "0")}`;
        return { e164, friendly: e164, locality: query.locality ?? "Southampton" };
      }).filter((n) => !this.taken.has(n.e164)),
    );
  }

  submitIdentity(details: NumberIdentityDetails): Promise<NumberIdentity> {
    const id = `BU${randomUUID().replace(/-/g, "").slice(0, 30)}`;
    this.identities.set(id, { details, status: "pending" });
    return Promise.resolve({ id, addressId: `AD${id.slice(2)}`, status: "pending" });
  }

  /** Test helper: the carrier finished its review. */
  decide(id: string, status: IdentityStatus): void {
    const identity = this.identities.get(id);
    if (identity) identity.status = status;
  }

  identityStatus(id: string): Promise<{ status: IdentityStatus; reason: string | null }> {
    const status = this.identities.get(id)?.status ?? "rejected";
    return Promise.resolve({
      status,
      reason: status === "rejected" ? "Address not verified" : null,
    });
  }

  buy(params: {
    e164: string;
    identityId: string;
    addressId: string;
    voiceUrl: string;
  }): Promise<{ carrierNumberId: string }> {
    if (this.taken.has(params.e164)) {
      return Promise.reject(new Error("number no longer available"));
    }
    const carrierNumberId = `PN${randomUUID().replace(/-/g, "").slice(0, 30)}`;
    this.bought.push({ ...params, carrierNumberId });
    this.taken.add(params.e164);
    return Promise.resolve({ carrierNumberId });
  }

  release(carrierNumberId: string): Promise<void> {
    this.released.push(carrierNumberId);
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

/** Accepts the token "human"; "down" acts like an unreachable service. */
export class MockHumanCheck implements HumanCheck {
  readonly name = "mock-human";
  readonly siteKey = "mock-site-key";
  readonly checked: string[] = [];

  verify(token: string): Promise<"human" | "bot" | "unavailable"> {
    this.checked.push(token);
    return Promise.resolve(token === "human" ? "human" : token === "down" ? "unavailable" : "bot");
  }
}

/**
 * Billing without Stripe. Webhook bodies are BillingEvent JSON signed with
 * `MockBilling.sign(body)`; tests put subscriptions in `subscriptions`.
 */
export class MockBilling implements BillingProvider {
  readonly name = "mock-billing";
  static readonly secret = "mock_whsec";
  readonly checkouts: Array<Parameters<BillingProvider["createCheckout"]>[0]> = [];
  readonly portals: Array<{ customerId: string; returnUrl: string }> = [];
  readonly subscriptions = new Map<string, BillingSubscription>();

  static sign(rawBody: string): string {
    return createHmac("sha256", MockBilling.secret).update(rawBody).digest("hex");
  }

  createCheckout(params: Parameters<BillingProvider["createCheckout"]>[0]) {
    this.checkouts.push(params);
    return Promise.resolve({ url: `https://billing.mock/checkout/${this.checkouts.length}` });
  }

  createPortal(params: { customerId: string; returnUrl: string }) {
    this.portals.push(params);
    return Promise.resolve({ url: `https://billing.mock/portal/${params.customerId}` });
  }

  parseWebhook(rawBody: string, signature: string | undefined): Promise<BillingEvent> {
    const expected = Buffer.from(MockBilling.sign(rawBody));
    const given = Buffer.from(signature ?? "");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return Promise.reject(new BillingSignatureError());
    }
    return Promise.resolve(JSON.parse(rawBody) as BillingEvent);
  }

  getSubscription(id: string) {
    return Promise.resolve(this.subscriptions.get(id) ?? null);
  }

  /** Add-on changes, in order (ADR 0032). */
  readonly addOns: Array<{ subscriptionId: string; priceId: string; quantity: number }> = [];

  setAddOnQuantity(subscriptionId: string, priceId: string, quantity: number): Promise<void> {
    this.addOns.push({ subscriptionId, priceId, quantity });
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) {
      const plan = sub.items ?? (sub.priceId ? [{ priceId: sub.priceId, quantity: 1 }] : []);
      const others = plan.filter((i) => i.priceId !== priceId);
      sub.items = quantity > 0 ? [...others, { priceId, quantity }] : others;
    }
    return Promise.resolve();
  }
}

/** Records pushes; endpoints containing "gone" act like an expired subscription. */
export class MockPush implements PushProvider {
  readonly name = "mock-push";
  readonly publicKey = "BMockPublicKeyForTests";
  readonly sent: Array<{ endpoint: string; message: PushMessage }> = [];

  send(subscription: PushSubscriptionData, message: PushMessage) {
    if (subscription.endpoint.includes("gone")) return Promise.resolve("gone" as const);
    this.sent.push({ endpoint: subscription.endpoint, message });
    return Promise.resolve("sent" as const);
  }
}

/** Voice typing without Deepgram: hands out a fake token. */
export class MockVoiceTyping implements VoiceTypingProvider {
  readonly name = "mock-voice-typing";
  readonly grants: string[] = [];
  grant(language: string): Promise<VoiceTypingGrant> {
    this.grants.push(language);
    return Promise.resolve({
      token: "mock-token",
      expiresIn: 30,
      url: `wss://voice-typing.mock/listen?language=${language}`,
      protocol: "bearer",
    });
  }
}
