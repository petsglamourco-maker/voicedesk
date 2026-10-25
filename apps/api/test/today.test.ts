import { bookings, channelThreads, staffMessages, withTenant } from "@voicedesk/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, createOwnerWithTenant, ORIGIN, type TestHarness } from "./harness";

let h: TestHarness;
let biz: Awaited<ReturnType<typeof createOwnerWithTenant>>;

beforeAll(async () => {
  h = await createHarness();
  biz = await createOwnerWithTenant(h, "Today Co");
  const soon = new Date(Date.now() + 60_000);
  await withTenant(h.db, biz.tenantId, async (tx) => {
    await tx.insert(bookings).values([
      {
        tenantId: biz.tenantId,
        reference: "TD-1",
        service: "Check-up",
        customerName: "Sam",
        startsAt: soon,
        endsAt: new Date(soon.getTime() + 1_800_000),
      },
      {
        tenantId: biz.tenantId,
        reference: "TD-2",
        service: "Check-up",
        customerName: "Lee",
        startsAt: soon,
        endsAt: new Date(soon.getTime() + 1_800_000),
        status: "cancelled",
      },
      {
        tenantId: biz.tenantId,
        reference: "TD-3",
        service: "Check-up",
        customerName: "Next week",
        startsAt: new Date(Date.now() + 7 * 86_400_000),
        endsAt: new Date(Date.now() + 7 * 86_400_000 + 1_800_000),
      },
    ]);
    await tx.insert(channelThreads).values({
      tenantId: biz.tenantId,
      channel: "whatsapp",
      externalId: "+447700900222",
      displayName: "Pat",
      needsHuman: true,
    });
    await tx.insert(staffMessages).values({
      tenantId: biz.tenantId,
      reference: "TD-M1",
      callerName: "Jo",
      callerPhone: "+447700900333",
      reason: "Please call me back about the quote",
    });
  });
});
afterAll(() => h.close());

describe("GET /today", () => {
  it("shows today's bookings, waiting chats and new messages", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/today`,
      headers: { cookie: biz.cookie, origin: ORIGIN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      bookings: Array<{ customerName: string }>;
      waitingChats: { count: number; items: Array<{ displayName: string }> };
      messages: { count: number; items: Array<{ callerName: string }> };
      missedCalls: { count: number };
      callbacks: { count: number };
    }>();
    // Cancelled and later bookings aren't today's (unless the test runs just before midnight).
    expect(body.bookings.map((b) => b.customerName)).toContain("Sam");
    expect(body.bookings.map((b) => b.customerName)).not.toContain("Lee");
    expect(body.bookings.map((b) => b.customerName)).not.toContain("Next week");
    expect(body.waitingChats).toMatchObject({ count: 1, items: [{ displayName: "Pat" }] });
    expect(body.messages).toMatchObject({ count: 1, items: [{ callerName: "Jo" }] });
    expect(body).toMatchObject({ missedCalls: { count: 0 }, callbacks: { count: 0 } });
  });

  it("is invisible to people outside the business", async () => {
    const other = await createOwnerWithTenant(h, "Other Today Co");
    const res = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/today`,
      headers: { cookie: other.cookie, origin: ORIGIN },
    });
    expect(res.statusCode).toBe(404);
  });
});
