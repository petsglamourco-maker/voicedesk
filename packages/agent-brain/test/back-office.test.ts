import { MockLlmProvider } from "@voicedesk/adapters";
import { randomUUID } from "node:crypto";
import { assistantActions, bookings, closeDb, user, withTenant } from "@voicedesk/db";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { askBackOffice, type BackOfficeUser } from "../src/back-office";

let dbs: TestDbs;
let tenantId: string;
let bookingId: string;
let userId: string;
const NOW = new Date("2026-10-21T08:00:00Z");

const owner = (): BackOfficeUser => ({
  tenantId,
  userId,
  permissions: [
    "records:read",
    "records:write",
    "calls:read",
    "contacts:read",
    "inbox:read",
    "inbox:reply",
  ],
  businessName: "Back Office Co",
  timezone: "Europe/London",
});

beforeAll(async () => {
  dbs = connectTestDbs();
  tenantId = await createTestTenant(dbs.app, "Back Office Co");
  const [u] = await dbs.app
    .insert(user)
    .values({ name: "Owner", email: `${randomUUID()}@example.com` })
    .returning({ id: user.id });
  userId = u!.id;
  const [b] = await withTenant(dbs.app, tenantId, (tx) =>
    tx
      .insert(bookings)
      .values({
        tenantId,
        reference: "BO-1",
        service: "Check-up",
        customerName: "Sam Patel",
        startsAt: new Date("2026-10-21T13:00:00Z"),
        endsAt: new Date("2026-10-21T13:30:00Z"),
      })
      .returning(),
  );
  bookingId = b!.id;
});
afterAll(async () => {
  await closeDb(dbs.app);
  await closeDb(dbs.owner);
});

describe("Ask VoiceDesk", () => {
  it("answers from the business's data using its tools", async () => {
    const llm = new MockLlmProvider().enqueue(
      MockLlmProvider.toolUse("bookings", { from: "2026-10-21", days: 1 }),
      MockLlmProvider.text("You have one booking today: Sam Patel, check-up at 14:00."),
    );
    const res = await askBackOffice({ db: dbs.app, llm }, owner(), "What's on today?", [], NOW);
    expect(res.used).toEqual(["bookings"]);
    expect(res.answer).toContain("Sam Patel");
    // The tool result the model saw has the booking in local time.
    const toolResult = JSON.stringify(llm.requests.at(-1)!.messages.at(-1));
    expect(toolResult).toContain("BO-1");
    expect(toolResult).toContain("14:00");
  });

  it("proposes a cancellation but never carries it out itself", async () => {
    const llm = new MockLlmProvider().enqueue(
      MockLlmProvider.toolUse("propose_cancel_booking", { bookingId, reason: "Dentist ill" }),
      MockLlmProvider.text("I've prepared the cancellation; approve it below."),
    );
    const res = await askBackOffice({ db: dbs.app, llm }, owner(), "Cancel Sam's booking", [], NOW);
    expect(res.actions).toHaveLength(1);
    expect(res.actions[0]).toMatchObject({ kind: "cancel_booking", status: "pending" });
    expect(res.actions[0]!.summary).toContain("BO-1");
    const [b] = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(bookings).where(eq(bookings.id, bookingId)),
    );
    expect(b?.status).toBe("confirmed");
  });

  it("only offers tools the user's role allows, and refuses others", async () => {
    const staff: BackOfficeUser = { ...owner(), permissions: ["records:read"] };
    const llm = new MockLlmProvider().enqueue(
      MockLlmProvider.toolUse("propose_cancel_booking", { bookingId }),
      MockLlmProvider.text("I can't do that."),
    );
    const res = await askBackOffice({ db: dbs.app, llm }, staff, "Cancel it", [], NOW);
    const offered = llm.requests[0]!.tools!.map((t) => t.name);
    expect(offered).toContain("bookings");
    expect(offered).not.toContain("propose_cancel_booking");
    expect(offered).not.toContain("recent_conversations");
    expect(res.actions).toEqual([]);
    const pending = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(assistantActions).where(eq(assistantActions.tenantId, tenantId)),
    );
    expect(pending).toHaveLength(1); // only the owner's earlier proposal
  });
});
