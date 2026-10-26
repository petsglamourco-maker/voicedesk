import {
  agentSettings,
  bookings,
  businessProfiles,
  closeDb,
  conversations,
  followUps,
  staffMessages,
  withTenant,
} from "@voicedesk/db";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LANGUAGES } from "../src/languages";
import {
  claimDueValueReports,
  monthName,
  previousMonth,
  renderValueReport,
  valueNumbers,
  type ValueNumbers,
} from "../src/value-report";
import { PROFILE } from "./fixtures";

const NUMBERS: ValueNumbers = {
  month: "2026-10",
  conversations: 48,
  calls: 30,
  chats: 18,
  outOfHours: 11,
  missedSaved: 4,
  assistantBookings: 9,
  followUpBookings: 2,
  messages: 7,
  callMinutes: 95,
  csat: 92,
  ratings: 12,
  estimatedValuePence: 9 * 4500,
  averageBookingPence: 4500,
};

describe("renderValueReport", () => {
  it("leads with what the assistant did and what the bookings were worth", () => {
    const { subject, text } = renderValueReport(NUMBERS, {
      lang: "en",
      business: "Bright Dental",
      link: "https://app.test/t/x",
    });
    expect(subject).toBe("Bright Dental: what your assistant did in October 2026");
    expect(text).toContain("Conversations handled: 48 (30 calls, 18 chats and messages)");
    expect(text).toContain("Calls answered while you were closed: 11");
    expect(text).toContain("Bookings made by the assistant: 9");
    expect(text).toContain("Bookings won back by follow-ups: 2");
    expect(text).toContain("Time on the phone for you: 95 minutes");
    expect(text).toContain("Estimated value of those bookings: £405 (9 × your average of £45)");
    expect(text).not.toContain("Tip:");
    expect(text.endsWith("Open VoiceDesk: https://app.test/t/x")).toBe(true);
  });

  it("suggests setting an average value, and leaves out what didn't happen", () => {
    const { text } = renderValueReport(
      {
        ...NUMBERS,
        outOfHours: null,
        missedSaved: 0,
        followUpBookings: 0,
        estimatedValuePence: null,
        averageBookingPence: null,
      },
      { lang: "en", business: "B", link: "l" },
    );
    expect(text).toContain("Tip: add your average booking value");
    expect(text).not.toContain("closed");
    expect(text).not.toContain("follow-ups");
    expect(text).not.toContain("Missed calls");
  });

  it.each(LANGUAGES)("%s has every line", (lang) => {
    const { subject, text } = renderValueReport(NUMBERS, { lang, business: "Glow", link: "L" });
    expect(subject).toContain("Glow");
    expect(subject).toContain(monthName("2026-10", lang));
    expect(text.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(8);
  });

  it("months roll over the year", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2026-10")).toBe("2026-09");
  });
});

describe("value report data and sending", () => {
  let dbs: TestDbs;
  beforeAll(() => {
    dbs = connectTestDbs();
  });
  afterAll(async () => {
    await closeDb(dbs.app);
    await closeDb(dbs.owner);
  });

  it("counts the month: out-of-hours calls, the assistant's bookings, follow-up wins", async () => {
    const tenantId = await createTestTenant(dbs.app, "Value Co");
    const conv = (values: Partial<typeof conversations.$inferInsert>) => ({
      tenantId,
      channel: "voice" as const,
      style: "voice",
      personaId: "amelia",
      language: "en",
      state: {},
      ...values,
    });
    await withTenant(dbs.app, tenantId, async (tx) => {
      await tx.insert(businessProfiles).values({
        tenantId,
        version: 1,
        status: "approved",
        data: PROFILE,
        generatedBy: "manual",
      });
      await tx.insert(agentSettings).values({ tenantId, averageBookingPence: 4500 });
      const [open, closed, , chat] = await tx
        .insert(conversations)
        .values([
          // Tuesday 14 Oct 2026, 10:00 BST: open. 4 minutes.
          conv({
            startedAt: new Date("2026-10-14T09:00:00Z"),
            endedAt: new Date("2026-10-14T09:04:00Z"),
          }),
          // Saturday 18 Oct: closed, and the team missed it (backup line).
          conv({
            startedAt: new Date("2026-10-18T10:00:00Z"),
            endedAt: new Date("2026-10-18T10:02:00Z"),
            entry: "backup",
          }),
          // Tuesday 21:30 BST: after closing.
          conv({ startedAt: new Date("2026-10-14T20:30:00Z") }),
          conv({ channel: "web_chat", style: "chat", startedAt: new Date("2026-10-15T12:00:00Z") }),
          // Test console and other months don't count.
          conv({ channel: "test_console", startedAt: new Date("2026-10-15T12:00:00Z") }),
          conv({ startedAt: new Date("2026-09-30T12:00:00Z") }),
        ])
        .returning({ id: conversations.id });
      const booking = (reference: string, conversationId: string | null, at: string) => ({
        tenantId,
        reference,
        conversationId,
        service: "Check-up",
        customerName: "Sam",
        startsAt: new Date("2026-11-02T10:00:00Z"),
        endsAt: new Date("2026-11-02T10:30:00Z"),
        createdAt: new Date(at),
      });
      const [won] = await tx
        .insert(bookings)
        .values([
          booking("V-1", open!.id, "2026-10-14T09:03:00Z"),
          booking("V-2", chat!.id, "2026-10-15T12:05:00Z"),
          // Made by staff (no conversation): not the assistant's.
          booking("V-3", null, "2026-10-16T12:00:00Z"),
        ])
        .returning({ id: bookings.id });
      await tx.insert(followUps).values({
        tenantId,
        conversationId: closed!.id,
        channel: "sms",
        to: "+447700900123",
        topic: "Check-up",
        language: "en",
        sendAt: new Date("2026-10-19T09:00:00Z"),
        status: "sent",
        bookingId: won!.id,
      });
      await tx.insert(staffMessages).values({
        tenantId,
        reference: "V-M1",
        conversationId: closed!.id,
        callerName: "Robin",
        callerPhone: "+447700900456",
        reason: "Call back",
        createdAt: new Date("2026-10-18T10:01:00Z"),
      });
    });

    const n = await valueNumbers(dbs.app, tenantId, "Europe/London", "2026-10");
    expect(n).toMatchObject({
      conversations: 4,
      calls: 3,
      chats: 1,
      outOfHours: 2,
      missedSaved: 1,
      assistantBookings: 2,
      followUpBookings: 1,
      messages: 1,
      callMinutes: 6,
      estimatedValuePence: 9000,
    });
  });

  it("is due once for last month, on the 1st after 08:00 local time, only when on", async () => {
    const t = await createTestTenant(dbs.app, "Monthly Co");
    expect(await claimDueValueReports(dbs.app, new Date("2026-11-01T07:30:00Z"), [t])).toEqual([]);
    const at = new Date("2026-11-01T08:30:00Z"); // 08:30 GMT
    expect(await claimDueValueReports(dbs.app, at, [t])).toEqual([t]);
    expect(await claimDueValueReports(dbs.app, at, [t])).toEqual([]);
    const [row] = await withTenant(dbs.app, t, (tx) =>
      tx.select().from(agentSettings).where(eq(agentSettings.tenantId, t)),
    );
    expect(row?.valueReportSentFor).toBe("2026-10");
    // Not mid-month, and not when switched off.
    expect(await claimDueValueReports(dbs.app, new Date("2026-11-15T09:00:00Z"), [t])).toEqual([]);
    await withTenant(dbs.app, t, (tx) =>
      tx.update(agentSettings).set({ valueReport: false }).where(eq(agentSettings.tenantId, t)),
    );
    expect(await claimDueValueReports(dbs.app, new Date("2026-12-01T09:00:00Z"), [t])).toEqual([]);
  });
});
