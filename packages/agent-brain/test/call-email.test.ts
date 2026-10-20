import { closeDb, conversations, member, user, withTenant } from "@voicedesk/db";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCallSummaryEmail, prepareCallSummaryEmails } from "../src/call-email";
import { createConversation } from "../src/persistence";
import { makeContext } from "./fixtures";
import type { CallEmailSummary } from "../src/call-email";

const SUMMARY: CallEmailSummary = {
  intent: "booking",
  outcome: "Booked a check-up for Tuesday 10:30",
  summary: "Sam called to book a check-up and took the first slot offered.",
  actionItems: ["Send the new-patient form"],
  followUpNeeded: false,
};

describe("buildCallSummaryEmail", () => {
  const base = {
    businessName: "Bright Dental",
    language: "en" as const,
    timezone: "Europe/London",
    callerPhone: "+447700900123",
    withheld: false,
    startedAt: new Date("2026-10-19T09:00:00Z"),
    durationSeconds: 125,
    records: [{ type: "booking", reference: "BD-7K4Q" }],
    summary: SUMMARY,
    link: "http://localhost:3000/t/x/calls/y",
  };

  it("gives the business what it needs to act, without the transcript", () => {
    const { subject, text } = buildCallSummaryEmail(base);
    expect(subject).toBe("Bright Dental: new call (booking)");
    expect(text).toContain("+447700900123");
    expect(text).toContain("2m 05s");
    expect(text).toContain("Booked a check-up");
    expect(text).toContain("- Send the new-patient form");
    expect(text).toContain("BD-7K4Q");
    expect(text).toContain(base.link);
  });

  it("flags follow-ups, withheld numbers and writes in the admin language", () => {
    const { subject, text } = buildCallSummaryEmail({
      ...base,
      language: "fr",
      callerPhone: null,
      withheld: true,
      summary: { ...SUMMARY, followUpNeeded: true },
    });
    expect(subject).toMatch(/^⚠ Bright Dental : nouvel appel \(réservation\)/);
    expect(text).toContain("Numéro masqué");
    expect(text).toContain("Suivi nécessaire");
  });

  it("says who took over from the assistant, or that nobody answered", () => {
    expect(buildCallSummaryEmail({ ...base, person: { name: "Sam", seconds: 80 } }).text).toContain(
      "Spoke with: Sam (1m 20s)",
    );
    expect(buildCallSummaryEmail({ ...base, person: { missed: true } }).text).toContain(
      "nobody answered the VA console in time",
    );
    expect(buildCallSummaryEmail(base).text).not.toContain("Spoke with");
  });
});

describe("prepareCallSummaryEmails", () => {
  let dbs: TestDbs;
  let tenantId: string;
  const ownerEmail = `owner-${randomUUID()}@example.com`;
  const staffEmail = `staff-${randomUUID()}@example.com`;

  beforeAll(async () => {
    dbs = connectTestDbs();
    tenantId = await createTestTenant(dbs.app, "Email Co");
    for (const [email, role] of [
      [ownerEmail, "owner"],
      [staffEmail, "staff"],
    ] as const) {
      const [u] = await dbs.app
        .insert(user)
        .values({ name: role, email })
        .returning({ id: user.id });
      await dbs.app
        .insert(member)
        .values({ organizationId: tenantId, userId: u!.id, role, createdAt: new Date() });
    }
  });
  afterAll(async () => {
    await closeDb(dbs.app);
    await closeDb(dbs.owner);
  });

  async function call(channel: "voice" | "test_console", summary: boolean) {
    const { conversationId } = await createConversation(dbs.app, makeContext({ style: "voice" }), {
      tenantId,
      channel,
      callerPhone: "+447700900123",
    });
    await withTenant(dbs.app, tenantId, (tx) =>
      tx
        .update(conversations)
        .set({
          status: "ended",
          endedAt: new Date(),
          summary: summary ? (SUMMARY as unknown as Record<string, unknown>) : null,
        })
        .where(eq(conversations.id, conversationId)),
    );
    return conversationId;
  }

  it("emails owners and admins about phone calls only", async () => {
    const phone = await call("voice", true);
    const emails = await prepareCallSummaryEmails(dbs.app, tenantId, phone, "https://app.test");
    expect(emails.map((e) => e.to)).toEqual([ownerEmail]);
    expect(emails[0]?.text).toContain(`https://app.test/t/${tenantId}/calls/${phone}`);

    const browserTest = await call("test_console", true);
    expect(await prepareCallSummaryEmails(dbs.app, tenantId, browserTest, "x")).toEqual([]);
    const noSummary = await call("voice", false);
    expect(await prepareCallSummaryEmails(dbs.app, tenantId, noSummary, "x")).toEqual([]);
  });
});
