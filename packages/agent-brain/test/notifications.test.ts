import { randomUUID } from "node:crypto";
import { MockEmbeddingProvider } from "@voicedesk/adapters";
import {
  agentSettings,
  bookings,
  closeDb,
  member,
  user,
  vaAssignments,
  withTenant,
} from "@voicedesk/db";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  customerBookingText,
  planBookingNotification,
  planBookingReminder,
  planRingingPush,
  planStaffAlert,
} from "../src/notifications";
import { createConversation } from "../src/persistence";
import { createDbAgentServices, type AgentNotification } from "../src/services-db";
import { makeContext } from "./fixtures";

let dbs: TestDbs;
let tenantId: string;
const ownerEmail = `owner-${randomUUID()}@example.com`;

beforeAll(async () => {
  dbs = connectTestDbs();
  tenantId = await createTestTenant(dbs.app, "Notify Co");
  const [u] = await dbs.app.insert(user).values({ name: "Owner", email: ownerEmail }).returning();
  await dbs.app
    .insert(member)
    .values({ organizationId: tenantId, userId: u!.id, role: "owner", createdAt: new Date() });
});
afterAll(async () => {
  await closeDb(dbs.app);
  await closeDb(dbs.owner);
});

async function settings(values: Partial<typeof agentSettings.$inferInsert>) {
  await withTenant(dbs.app, tenantId, (tx) =>
    tx
      .insert(agentSettings)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: agentSettings.tenantId, set: values }),
  );
}

async function booked(language: "en" | "es" = "en", email: string | null = null) {
  const events: AgentNotification[] = [];
  const { conversationId } = await createConversation(dbs.app, makeContext(), {
    tenantId,
    channel: "test_console",
    language,
  });
  const svc = createDbAgentServices(
    {
      db: dbs.app,
      embeddings: new MockEmbeddingProvider(),
      notify: (e) => Promise.resolve(void events.push(e)),
    },
    { tenantId, conversationId, businessName: "Notify Co", timezone: "Europe/London" },
  );
  const startsAt = new Date(Date.now() + 3 * 86_400_000);
  const created = await svc.createBooking({
    service: "Check-up",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 1_800_000),
    customerName: "Sam Patel",
    customerPhone: "+447700900123",
    customerEmail: email,
    notes: null,
  });
  return { created, startsAt, events, svc };
}

describe("customer booking messages", () => {
  it("are short, in the customer's language, with the reference", () => {
    const b = {
      business: "Bright Dental",
      service: "Check-up",
      when: "Tue 20 Oct, 10:00",
      reference: "BD-7K4Q",
      contactPhone: "020 7946 0958",
    };
    expect(customerBookingText("en", "created", b).text).toBe(
      "Bright Dental: your Check-up is booked for Tue 20 Oct, 10:00. Ref BD-7K4Q. To change it, call 020 7946 0958.",
    );
    expect(customerBookingText("es", "cancelled", b).text).toMatch(/cancelada.*BD-7K4Q\.$/);
    expect(customerBookingText("en", "created", b).text.length).toBeLessThan(160);
  });
});

describe("booking notifications", () => {
  it("confirms by SMS (and email) and schedules a reminder", async () => {
    await settings({ reminderHours: 24, customerConfirmations: true });
    const { created, startsAt, events } = await booked("es", "sam@example.com");
    expect(events).toEqual([{ kind: "booking.changed", bookingId: created.id, change: "created" }]);
    const plan = await planBookingNotification(dbs.app, {
      tenantId,
      bookingId: created.id,
      change: "created",
    });
    expect(plan.messages.map((m) => m.channel)).toEqual(["sms", "email"]);
    expect(plan.messages[0]).toMatchObject({ to: "+447700900123" });
    expect(plan.messages[0]!.text).toMatch(/reservada/); // the conversation was in Spanish
    expect(plan.reminder).toMatchObject({ action: "schedule", bookingId: created.id });
    if (plan.reminder?.action === "schedule") {
      expect(plan.reminder.runAt.getTime()).toBe(startsAt.getTime() - 24 * 3600_000);
    }
  });

  it("respects the business's settings", async () => {
    await settings({ reminderHours: 0, customerConfirmations: false });
    const { created } = await booked();
    const plan = await planBookingNotification(dbs.app, {
      tenantId,
      bookingId: created.id,
      change: "created",
    });
    expect(plan.messages).toEqual([]);
    expect(plan.reminder).toEqual({ action: "remove", bookingId: created.id });
    await settings({ reminderHours: 24, customerConfirmations: true });
  });

  it("removes the reminder when cancelled and skips a stale reminder after a move", async () => {
    const { created, startsAt, svc, events } = await booked();
    const later = new Date(startsAt.getTime() + 3600_000);
    await svc.rescheduleBooking(created.id, later, new Date(later.getTime() + 1_800_000));
    expect(events.at(-1)).toMatchObject({ change: "moved" });
    const stale = await planBookingReminder(dbs.app, {
      tenantId,
      bookingId: created.id,
      startsAt: startsAt.toISOString(),
    });
    expect(stale.messages).toEqual([]);
    const fresh = await planBookingReminder(dbs.app, {
      tenantId,
      bookingId: created.id,
      startsAt: later.toISOString(),
    });
    expect(fresh.messages[0]?.text).toMatch(/^Reminder from/);

    await svc.cancelBooking(created.id);
    expect(events.at(-1)).toMatchObject({ change: "cancelled" });
    const plan = await planBookingNotification(dbs.app, {
      tenantId,
      bookingId: created.id,
      change: "cancelled",
    });
    expect(plan.reminder).toEqual({ action: "remove", bookingId: created.id });
    const [row] = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(bookings).where(eq(bookings.id, created.id)),
    );
    expect(row?.status).toBe("cancelled");
  });
});

describe("staff alerts", () => {
  it("emails owners and texts the on-call number about urgent tickets straight away", async () => {
    await settings({ alertPhone: "+447700900999" });
    const events: AgentNotification[] = [];
    const { conversationId } = await createConversation(dbs.app, makeContext(), {
      tenantId,
      channel: "test_console",
    });
    const svc = createDbAgentServices(
      {
        db: dbs.app,
        embeddings: new MockEmbeddingProvider(),
        notify: (e) => Promise.resolve(void events.push(e)),
      },
      { tenantId, conversationId, businessName: "Notify Co" },
    );
    const ticket = await svc.createTicket({
      priority: "urgent",
      summary: "Filling fell out, in pain",
      details: {
        callerName: "Sam",
        callbackPhone: "+447700900123",
        callbackTime: "this afternoon",
      },
    });
    await svc.takeMessage({
      callerName: "Jo",
      callerPhone: "+447700900124",
      reason: "Invoice",
      urgency: "normal",
      bestTime: "any time",
    });
    expect(events).toEqual([{ kind: "staff.alert", record: "ticket", id: ticket.id }]);
    const plan = await planStaffAlert(
      dbs.app,
      { tenantId, record: "ticket", id: ticket.id },
      "https://app.test",
    );
    expect(plan.messages.map((m) => [m.channel, m.channel === "push" ? "user" : m.to])).toEqual([
      ["email", ownerEmail],
      ["sms", "+447700900999"],
      ["push", "user"],
    ]);
    expect(plan.messages[0]!.text).toContain("Filling fell out");
    expect(plan.messages[0]!.text).toContain(`https://app.test/t/${tenantId}/records`);
    // The phone notification says what kind of thing happened, never who or what was said.
    const push = plan.messages[2]!;
    expect(push).toMatchObject({
      text: "Urgent issue",
      path: `/t/${tenantId}/records`,
      urgent: true,
    });
    expect(JSON.stringify(push)).not.toMatch(/Filling|\+44|Invoice/);
  });
});

describe("ringing calls", () => {
  it("pushes to the people who answer calls, with no caller details", async () => {
    const [va] = await dbs.app
      .insert(user)
      .values({ name: "VA", email: `va-${randomUUID()}@example.com` })
      .returning();
    await withTenant(dbs.app, tenantId, (tx) =>
      tx.insert(vaAssignments).values({ tenantId, userId: va!.id, source: "business" }),
    );
    const handoffId = randomUUID();
    const plan = await planRingingPush(dbs.app, { tenantId, handoffId });
    expect(plan.messages).toEqual([
      expect.objectContaining({
        channel: "push",
        to: va!.id,
        text: "A call is waiting for you",
        path: "/va",
        urgent: true,
        tag: `call-${handoffId}`,
      }),
    ]);
  });
});
