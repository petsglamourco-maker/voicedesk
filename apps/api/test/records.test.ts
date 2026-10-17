import { MockEmbeddingProvider } from "@voicedesk/adapters";
import {
  createConversation,
  createDbAgentServices,
  loadAgentContext,
} from "@voicedesk/agent-brain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, createOwnerWithTenant, ORIGIN, type TestHarness } from "./harness";

let h: TestHarness;
let owner: Awaited<ReturnType<typeof createOwnerWithTenant>>;
let ids: { ticket: string; message: string; booking: string };

beforeAll(async () => {
  h = await createHarness();
  owner = await createOwnerWithTenant(h, "Records Co");
  const ctx = await loadAgentContext(h.db, owner.tenantId, "chat");
  const { conversationId } = await createConversation(h.db, ctx, {
    tenantId: owner.tenantId,
    channel: "test_console",
  });
  const svc = createDbAgentServices(
    { db: h.db, embeddings: new MockEmbeddingProvider() },
    { tenantId: owner.tenantId, conversationId, businessName: "Records Co" },
  );
  const ticket = await svc.createTicket({
    priority: "normal",
    summary: "Late delivery",
    details: {},
  });
  const message = await svc.takeMessage({
    callerName: "Jo",
    callerPhone: "+447700900124",
    reason: "Invoice",
    urgency: "normal",
    bestTime: "any time",
  });
  const startsAt = new Date(Date.now() + 2 * 86_400_000);
  const booking = await svc.createBooking({
    service: "Check-up",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 1_800_000),
    customerName: "Sam",
    customerPhone: "+447700900123",
    customerEmail: null,
    notes: null,
  });
  ids = { ticket: ticket.id, message: message.id, booking: booking.id };
});
afterAll(() => h.close());

const headers = (cookie = owner.cookie) => ({ cookie, origin: ORIGIN });
const base = () => `/api/tenants/${owner.tenantId}`;

describe("record actions", () => {
  it("moves tickets and messages along", async () => {
    const t = await h.app.inject({
      method: "PATCH",
      url: `${base()}/tickets/${ids.ticket}`,
      headers: headers(),
      payload: { status: "resolved" },
    });
    expect(t.json()).toMatchObject({ status: "resolved" });
    const m = await h.app.inject({
      method: "PATCH",
      url: `${base()}/messages/${ids.message}`,
      headers: headers(),
      payload: { status: "done" },
    });
    expect(m.json()).toMatchObject({ status: "done" });
  });

  it("cancels a booking and tells the customer", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: `${base()}/bookings/${ids.booking}/cancel`,
      headers: headers(),
    });
    expect(res.json()).toMatchObject({ status: "cancelled" });
    expect(h.jobs.notifications).toContainEqual({
      kind: "booking.changed",
      tenantId: owner.tenantId,
      bookingId: ids.booking,
      change: "cancelled",
    });
    const again = await h.app.inject({
      method: "POST",
      url: `${base()}/bookings/${ids.booking}/cancel`,
      headers: headers(),
    });
    expect(again.statusCode).toBe(409);
  });

  it("is invisible to other businesses", async () => {
    const other = await createOwnerWithTenant(h, "Other Records Co");
    const res = await h.app.inject({
      method: "PATCH",
      url: `/api/tenants/${other.tenantId}/tickets/${ids.ticket}`,
      headers: headers(other.cookie),
      payload: { status: "closed" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("notification settings", () => {
  it("stores reminder hours and a normalised alert number", async () => {
    const put = await h.app.inject({
      method: "PUT",
      url: `${base()}/agent`,
      headers: headers(),
      payload: {
        personaId: "amelia",
        personaNames: {},
        enabledLanguages: ["en"],
        adminLanguage: "en",
        reminderHours: 48,
        customerConfirmations: false,
        alertPhone: "07700 900999",
      },
    });
    expect(put.statusCode).toBe(204);
    const get = await h.app.inject({ method: "GET", url: `${base()}/agent`, headers: headers() });
    expect(get.json()).toMatchObject({
      settings: { reminderHours: 48, customerConfirmations: false, alertPhone: "+447700900999" },
    });
    const bad = await h.app.inject({
      method: "PUT",
      url: `${base()}/agent`,
      headers: headers(),
      payload: {
        personaId: "amelia",
        personaNames: {},
        enabledLanguages: ["en"],
        adminLanguage: "en",
        alertPhone: "12",
      },
    });
    expect(bad.statusCode).toBe(400);
  });
});
