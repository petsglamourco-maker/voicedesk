import { randomUUID } from "node:crypto";
import { MockEmbeddingProvider, MockLlmProvider } from "@voicedesk/adapters";
import { channelThreads, closeDb, contacts, withTenant } from "@voicedesk/db";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processFormSubmission, type FormSubmission } from "../src/forms";

let dbs: TestDbs;
let tenantId: string;

beforeAll(async () => {
  dbs = connectTestDbs();
  tenantId = await createTestTenant(dbs.app, "Form Triage Co");
});
afterAll(async () => {
  await closeDb(dbs.app);
  await closeDb(dbs.owner);
});

const form = (over: Partial<FormSubmission> = {}): FormSubmission => ({
  submissionId: randomUUID(),
  name: "Robin Shaw",
  email: `robin-${randomUUID().slice(0, 6)}@example.com`,
  phone: "07700 900456",
  message: "Can I book a check-up next week?",
  extra: { service: "Check-up" },
  contactConsent: true,
  marketingConsent: false,
  source: "hosted",
  ...over,
});

const run = (submission: FormSubmission) =>
  processFormSubmission(
    {
      db: dbs.app,
      llm: new MockLlmProvider().enqueue(
        MockLlmProvider.text("Thanks Robin, we have slots on Tuesday."),
      ),
      embeddings: new MockEmbeddingProvider(),
    },
    tenantId,
    submission,
  );

describe("form triage", () => {
  it("creates a thread and contact, and keeps the reply as a draft", async () => {
    const submission = form();
    const { threadId } = await run(submission);
    const [thread] = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(channelThreads).where(eq(channelThreads.id, threadId)),
    );
    expect(thread).toMatchObject({
      channel: "web_form",
      needsHuman: true,
      displayName: "Robin Shaw",
    });
    expect(thread!.meta).toMatchObject({ replyTo: submission.email, contactConsent: true });
    const [contact] = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(contacts).where(eq(contacts.id, thread!.contactId!)),
    );
    expect(contact).toMatchObject({ email: submission.email, phoneE164: "+447700900456" });
  });

  it("doesn't offer an email reply without consent", async () => {
    const { threadId } = await run(form({ contactConsent: false, phone: null }));
    const [thread] = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(channelThreads).where(eq(channelThreads.id, threadId)),
    );
    expect(thread!.meta).not.toHaveProperty("replyTo");
    expect(thread!.contactId).not.toBeNull();
  });
});
