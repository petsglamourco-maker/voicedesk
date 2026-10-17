import { randomBytes, randomUUID } from "node:crypto";
import {
  InMemoryCalendarProvider,
  MockEmbeddingProvider,
  ProviderError,
  type CalendarProvider,
} from "@voicedesk/adapters";
import {
  chooseCalendar,
  getCalendarConnection,
  saveGoogleConnection,
  SecretBox,
  type CalendarFactory,
} from "@voicedesk/core";
import { bookings, closeDb, withTenant } from "@voicedesk/db";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConversation } from "../src/persistence";
import { createDbAgentServices, invalidateBusyCache } from "../src/services-db";
import { makeContext } from "./fixtures";

let dbs: TestDbs;
const box = new SecretBox(randomBytes(32).toString("base64"));

beforeAll(() => {
  dbs = connectTestDbs();
});
afterAll(async () => {
  await closeDb(dbs.app);
  await closeDb(dbs.owner);
});

async function connectedTenant() {
  const tenantId = await createTestTenant(dbs.app, "Calendar Co");
  await saveGoogleConnection(dbs.app, box, {
    tenantId,
    userId: randomUUID(),
    refreshToken: "rt-secret",
    accountEmail: "owner@example.com",
  });
  await chooseCalendar(dbs.app, tenantId, { id: "primary", name: "Owner" });
  return tenantId;
}

async function services(tenantId: string, factory: CalendarFactory) {
  const { conversationId } = await createConversation(dbs.app, makeContext(), {
    tenantId,
    channel: "test_console",
  });
  return createDbAgentServices(
    {
      db: dbs.app,
      embeddings: new MockEmbeddingProvider(),
      calendars: { box, factory },
    },
    { tenantId, conversationId, businessName: "Calendar Co", timezone: "Europe/London" },
  );
}

const day = { from: new Date("2026-10-20T00:00:00Z"), to: new Date("2026-10-21T00:00:00Z") };

describe("agent services with a connected Google calendar", () => {
  it("treats the business's own appointments as busy and puts bookings in the calendar", async () => {
    const tenantId = await connectedTenant();
    const calendar = new InMemoryCalendarProvider();
    await calendar.createEvent("primary", {
      title: "Dentist conference",
      start: new Date("2026-10-20T13:00:00Z"),
      end: new Date("2026-10-20T15:00:00Z"),
      timezone: "Europe/London",
    });
    const tokens: string[] = [];
    const svc = await services(tenantId, (_row, token) => {
      tokens.push(token);
      return calendar;
    });

    const busy = await svc.listBusy(day.from, day.to);
    expect(busy.map((b) => b.startsAt.toISOString())).toContain("2026-10-20T13:00:00.000Z");
    expect(tokens).toEqual(["rt-secret"]); // decrypted for this business only

    const created = await svc.createBooking({
      service: "Check-up",
      startsAt: new Date("2026-10-20T09:00:00Z"),
      endsAt: new Date("2026-10-20T09:30:00Z"),
      customerName: "Sam Patel",
      customerPhone: "+447700900123",
      customerEmail: null,
      notes: null,
    });
    const events = await calendar.freeBusy(["primary"], { start: day.from, end: day.to });
    expect(events).toHaveLength(2);
    const [row] = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(bookings).where(eq(bookings.id, created.id)),
    );
    expect(row?.externalEventId).toBeTruthy();
  });

  it("keeps working on VoiceDesk bookings when Google fails, and flags the connection", async () => {
    const tenantId = await connectedTenant();
    const broken: CalendarProvider = {
      name: "broken",
      freeBusy: () =>
        Promise.reject(new ProviderError("google-calendar", "HTTP 503", { retryable: true })),
      createEvent: () =>
        Promise.reject(new ProviderError("google-calendar", "HTTP 503", { retryable: true })),
      updateEvent: () => Promise.reject(new Error("no")),
      deleteEvent: () => Promise.reject(new Error("no")),
    };
    const svc = await services(tenantId, () => broken);
    invalidateBusyCache(tenantId);
    await expect(svc.listBusy(day.from, day.to)).resolves.toEqual([]);
    const created = await svc.createBooking({
      service: "Check-up",
      startsAt: new Date("2026-10-20T10:00:00Z"),
      endsAt: new Date("2026-10-20T10:30:00Z"),
      customerName: "Jo",
      customerPhone: "+447700900124",
      customerEmail: null,
      notes: null,
    });
    expect(created.reference).toBeTruthy();
    const connection = await getCalendarConnection(dbs.app, tenantId);
    expect(connection?.status).toBe("error");
    expect(connection?.lastError).toMatch(/503/);
  });

  it("marks revoked access so the business is asked to reconnect", async () => {
    const tenantId = await connectedTenant();
    const revoked: CalendarProvider = {
      name: "revoked",
      freeBusy: () =>
        Promise.reject(
          new ProviderError("google-calendar", "token request failed: HTTP 400 invalid_grant"),
        ),
      createEvent: () => Promise.reject(new Error("no")),
      updateEvent: () => Promise.reject(new Error("no")),
      deleteEvent: () => Promise.reject(new Error("no")),
    };
    await (await services(tenantId, () => revoked)).listBusy(day.from, day.to);
    expect((await getCalendarConnection(dbs.app, tenantId))?.status).toBe("revoked");
  });

  it("finds, moves and cancels bookings, keeping the Google event in step", async () => {
    const tenantId = await connectedTenant();
    const calendar = new InMemoryCalendarProvider();
    const svc = await services(tenantId, () => calendar);
    const startsAt = new Date(Date.now() + 3 * 86_400_000);
    const created = await svc.createBooking({
      service: "Check-up",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      customerName: "Sam Patel",
      customerPhone: "+447700900123",
      customerEmail: null,
      notes: null,
    });
    const window = {
      start: new Date(startsAt.getTime() - 86_400_000),
      end: new Date(startsAt.getTime() + 2 * 86_400_000),
    };
    const byRef = await svc.findBookings({ reference: created.reference });
    expect(byRef.map((b) => b.id)).toEqual([created.id]);
    expect(await svc.findBookings({ phone: "+447700900123" })).toHaveLength(1);
    expect(await svc.findBookings({ phone: "+447700900999" })).toHaveLength(0);

    const later = new Date(startsAt.getTime() + 3600_000);
    await svc.rescheduleBooking(created.id, later, new Date(later.getTime() + 30 * 60_000));
    const [event] = await calendar.freeBusy(["primary"], window);
    expect(event?.start.toISOString()).toBe(later.toISOString());

    await svc.cancelBooking(created.id);
    expect(await calendar.freeBusy(["primary"], window)).toEqual([]);
    expect(await svc.findBookings({ reference: created.reference })).toEqual([]);
  });

  it("stores the refresh token encrypted", async () => {
    const tenantId = await connectedTenant();
    const row = await getCalendarConnection(dbs.app, tenantId);
    expect(row?.refreshTokenEncrypted).not.toContain("rt-secret");
    expect(row?.refreshTokenEncrypted.startsWith("v1:")).toBe(true);
  });
});
