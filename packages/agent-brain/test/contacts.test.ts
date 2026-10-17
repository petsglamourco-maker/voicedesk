import { MockEmbeddingProvider } from "@voicedesk/adapters";
import { closeDb, contacts, conversations, withTenant } from "@voicedesk/db";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConversation } from "../src/persistence";
import { createDbAgentServices } from "../src/services-db";
import { stepNote } from "../src/state";
import { makeContext } from "./fixtures";

let dbs: TestDbs;
let tenantId: string;
const phone = "+447700900777";

beforeAll(async () => {
  dbs = connectTestDbs();
  tenantId = await createTestTenant(dbs.app, "Contacts Co");
});
afterAll(async () => {
  await closeDb(dbs.app);
  await closeDb(dbs.owner);
});

async function conversationWith(callerPhone: string | null) {
  return createConversation(dbs.app, makeContext({ style: "voice", timezone: "Europe/London" }), {
    tenantId,
    channel: "voice",
    callerPhone,
  });
}

describe("contacts and caller recognition", () => {
  it("turns a first-time caller who books into a contact, linked to the booking and call", async () => {
    const first = await conversationWith(phone);
    expect(first.state.knownCaller).toBeUndefined();
    const svc = createDbAgentServices(
      { db: dbs.app, embeddings: new MockEmbeddingProvider() },
      { tenantId, conversationId: first.conversationId, businessName: "Contacts Co" },
    );
    await svc.createBooking({
      service: "Check-up",
      startsAt: new Date(Date.now() + 2 * 86_400_000),
      endsAt: new Date(Date.now() + 2 * 86_400_000 + 1_800_000),
      customerName: "Priya Shah",
      customerPhone: phone,
      customerEmail: null,
      notes: null,
    });
    const [contact] = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(contacts).where(eq(contacts.phoneE164, phone)),
    );
    expect(contact).toMatchObject({ fullName: "Priya Shah", source: "assistant" });
    const [conv] = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(conversations).where(eq(conversations.id, first.conversationId)),
    );
    expect(conv?.contactId).toBe(contact!.id);
  });

  it("recognises them next time, with their upcoming booking", async () => {
    const again = await conversationWith(phone);
    expect(again.state.knownCaller?.name).toBe("Priya Shah");
    expect(again.state.knownCaller?.upcoming).toHaveLength(1);
    again.state.turns = 1;
    expect(stepNote(again.state, "now")).toMatch(/Returning customer.*Priya Shah.*Check-up/);
  });

  it("never overwrites details the business already has", async () => {
    await withTenant(dbs.app, tenantId, (tx) =>
      tx.update(contacts).set({ fullName: "Priya Shah-Khan" }).where(eq(contacts.phoneE164, phone)),
    );
    const conv = await conversationWith(phone);
    const svc = createDbAgentServices(
      { db: dbs.app, embeddings: new MockEmbeddingProvider() },
      { tenantId, conversationId: conv.conversationId, businessName: "Contacts Co" },
    );
    await svc.takeMessage({
      callerName: "P Shah",
      callerPhone: phone,
      reason: "Invoice question",
      urgency: "normal",
      bestTime: "after 3pm",
    });
    const rows = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(contacts).where(eq(contacts.phoneE164, phone)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fullName).toBe("Priya Shah-Khan");
  });

  it("doesn't recognise withheld or unknown numbers", async () => {
    expect((await conversationWith(null)).state.knownCaller).toBeUndefined();
    expect((await conversationWith("+447700900000")).state.knownCaller).toBeUndefined();
  });
});
