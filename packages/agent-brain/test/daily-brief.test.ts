import { agentSettings, bookings, closeDb, tickets, withTenant } from "@voicedesk/db";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { briefNumbers, claimDueBriefs, renderBrief, type BriefNumbers } from "../src/daily-brief";

const EMPTY: BriefNumbers = {
  calls: 0,
  chats: 0,
  bookingsMade: 0,
  cancelled: 0,
  tickets: 0,
  messages: 0,
  missedHandoffs: 0,
  missedByTeam: 0,
  unanswered: 0,
  csat: null,
  ratings: 0,
  today: [],
  openTickets: 0,
  waiting: 0,
  drafts: 0,
};

describe("renderBrief", () => {
  it("lists yesterday, today and what needs attention, only mentioning what happened", () => {
    const { subject, text } = renderBrief(
      {
        ...EMPTY,
        calls: 12,
        chats: 4,
        bookingsMade: 3,
        cancelled: 1,
        missedHandoffs: 2,
        csat: 80,
        ratings: 5,
        today: [{ time: "09:30", service: "Check-up", customer: "Sam" }],
        openTickets: 2,
      },
      { lang: "en", business: "Bright Dental", date: "2026-10-21", link: "https://app/t/x" },
    );
    expect(subject).toBe("Bright Dental: your daily brief for 2026-10-21");
    expect(text).toContain("- Calls: 12");
    expect(text).toContain("- Bookings made: 3 (Cancelled: 1)");
    expect(text).toContain("- Callers nobody could take: 2");
    expect(text).toContain("Satisfied customers: 80% (5 ratings)");
    expect(text).toContain("- 09:30 Check-up · Sam");
    expect(text).toContain("- Open tickets: 2");
    expect(text).not.toContain("Questions the assistant couldn't answer");
    expect(renderBrief(EMPTY, { lang: "en", business: "B", date: "d", link: "l" }).text).toContain(
      "Nothing waiting. Have a good day!",
    );
  });
});

describe("brief data and sending", () => {
  let dbs: TestDbs;
  let tenantId: string;
  beforeAll(async () => {
    dbs = connectTestDbs();
    tenantId = await createTestTenant(dbs.app, "Brief Co");
  });
  afterAll(async () => {
    await closeDb(dbs.app);
    await closeDb(dbs.owner);
  });

  it("counts the business's local yesterday and today", async () => {
    const now = new Date("2026-10-21T08:00:00Z"); // 09:00 in London (BST)
    await withTenant(dbs.app, tenantId, async (tx) => {
      await tx.insert(bookings).values([
        {
          tenantId,
          reference: "BC-1",
          service: "Check-up",
          customerName: "Sam",
          startsAt: new Date("2026-10-21T13:00:00Z"),
          endsAt: new Date("2026-10-21T13:30:00Z"),
          createdAt: new Date("2026-10-20T10:00:00Z"),
        },
        {
          tenantId,
          reference: "BC-2",
          service: "Cleaning",
          customerName: "Old",
          startsAt: new Date("2026-10-25T13:00:00Z"),
          endsAt: new Date("2026-10-25T13:30:00Z"),
          createdAt: new Date("2026-10-18T10:00:00Z"),
        },
      ]);
      await tx.insert(tickets).values({
        tenantId,
        reference: "BC-T1",
        summary: "Leak",
        category: "complaint",
        details: {},
      });
    });
    const n = await briefNumbers(dbs.app, tenantId, "Europe/London", now);
    expect(n.bookingsMade).toBe(1);
    expect(n.today).toEqual([{ time: "14:00", service: "Check-up", customer: "Sam" }]);
    expect(n.openTickets).toBe(1);
  });

  it("is due once a day after 07:30 local time, and only when switched on", async () => {
    const t = await createTestTenant(dbs.app, "Due Co");
    const early = new Date("2026-10-21T06:00:00Z"); // 07:00 BST
    const later = new Date("2026-10-21T07:00:00Z"); // 08:00 BST
    expect(await claimDueBriefs(dbs.app, early, [t])).not.toContain(t);
    expect(await claimDueBriefs(dbs.app, later, [t])).toContain(t);
    expect(await claimDueBriefs(dbs.app, later, [t])).not.toContain(t);
    const nextDay = new Date("2026-10-22T07:00:00Z");
    await withTenant(dbs.app, t, (tx) =>
      tx.update(agentSettings).set({ dailyBrief: false }).where(eq(agentSettings.tenantId, t)),
    );
    expect(await claimDueBriefs(dbs.app, nextDay, [t])).not.toContain(t);
  });
});
