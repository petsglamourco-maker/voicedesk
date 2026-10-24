import { randomBytes, randomUUID } from "node:crypto";
import { MockEmbeddingProvider, MockLlmProvider } from "@voicedesk/adapters";
import type {
  FetchResult,
  InboundEmail,
  MailboxClient,
  OutgoingEmail,
} from "@voicedesk/adapters/email/mailbox";
import { createLogger } from "@voicedesk/compliance/logger";
import { deleteMailbox, getMailbox, saveMailbox, SecretBox } from "@voicedesk/core";
import { channelThreads, closeDb, withTenant } from "@voicedesk/db";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import type { ChannelJob, Job } from "@voicedesk/jobs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createChannelProcessor, type LiveMessage } from "../src/processors/channels";

const log = createLogger("test", "silent");
const box = new SecretBox(randomBytes(32).toString("base64"));
let dbs: TestDbs;

beforeAll(() => {
  dbs = connectTestDbs();
});
afterAll(async () => {
  await closeDb(dbs.app);
  await closeDb(dbs.owner);
});

function email(uid: number, over: Partial<InboundEmail> = {}): InboundEmail {
  return {
    uid,
    messageId: `<${randomUUID()}@mail.example>`,
    inReplyTo: null,
    references: [],
    from: { address: `cust-${uid}-${randomUUID().slice(0, 6)}@example.com`, name: null },
    subject: "Question",
    text: "Are you open on Sunday?",
    date: new Date(),
    automated: false,
    authenticated: true,
    attachmentNames: [],
    ...over,
  };
}

class FakeMailbox implements MailboxClient {
  sent: OutgoingEmail[] = [];
  calls: Array<[number, number | null]> = [];
  constructor(private readonly result: FetchResult | Error) {}
  verify() {
    return Promise.resolve();
  }
  fetchNew(_folder: string, lastUid: number, uidValidity: number | null) {
    this.calls.push([lastUid, uidValidity]);
    return this.result instanceof Error
      ? Promise.reject(this.result)
      : Promise.resolve(this.result);
  }
  send(message: OutgoingEmail) {
    this.sent.push(message);
    return Promise.resolve({ messageId: "<sent>" });
  }
}

async function setup(fake: FakeMailbox, llm: MockLlmProvider) {
  const tenantId = await createTestTenant(dbs.app, "Mailbox Co");
  const row = await saveMailbox(dbs.app, box, tenantId, {
    emailAddress: "help@mailbox.example",
    username: "help@mailbox.example",
    password: "app-password",
    imap: { host: "imap.example", port: 993, secure: true },
    smtp: { host: "smtp.example", port: 465, secure: true },
    folder: "INBOX",
    autoSend: false,
  });
  const live: LiveMessage[] = [];
  const process = createChannelProcessor(
    {
      db: dbs.app,
      llm,
      embeddings: new MockEmbeddingProvider(),
      whatsapp: null,
      publishLive: (e) => Promise.resolve(void live.push(e)),
      box,
      mailboxClient: (creds) => {
        expect(creds.password).toBe("app-password");
        return fake;
      },
    },
    log,
  );
  const run = () =>
    process({
      id: "1",
      data: { kind: "email.poll", tenantId, mailboxId: row.id },
    } as Job<ChannelJob>);
  return { tenantId, row, live, run };
}

describe("mailbox poller", () => {
  it("drafts replies to new mail, skips automated mail, and saves the read position", async () => {
    const fake = new FakeMailbox({
      uidValidity: 7,
      lastUid: 12,
      messages: [email(11), email(12, { automated: true })],
    });
    const llm = new MockLlmProvider().enqueue(MockLlmProvider.text("Yes, 10am to 2pm."));
    const { tenantId, live, run } = await setup(fake, llm);

    const result = await run();
    expect(result).toEqual({ outcomes: ["draft", "skipped"] });
    expect(fake.calls).toEqual([[0, null]]);
    expect(fake.sent).toEqual([]); // waiting for approval
    expect(live).toHaveLength(1);

    const saved = await getMailbox(dbs.app, tenantId);
    expect(saved).toMatchObject({ uidValidity: 7, lastUid: 12, status: "active" });
    const threads = await withTenant(dbs.app, tenantId, (tx) => tx.select().from(channelThreads));
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ channel: "email", needsHuman: true });
  });

  it("records connection errors on the mailbox for the settings page", async () => {
    const fake = new FakeMailbox(new Error("Invalid credentials (Failure)"));
    const { tenantId, run } = await setup(fake, new MockLlmProvider());
    expect(await run()).toEqual({ error: true });
    const saved = await getMailbox(dbs.app, tenantId);
    expect(saved).toMatchObject({ status: "error", lastError: "Invalid credentials (Failure)" });
  });

  it("does nothing for a mailbox that has been disconnected", async () => {
    const fake = new FakeMailbox({ uidValidity: 1, lastUid: 0, messages: [] });
    const { tenantId, run } = await setup(fake, new MockLlmProvider());
    await deleteMailbox(dbs.app, tenantId);
    expect(await run()).toEqual({ skipped: true });
    expect(fake.calls).toEqual([]);
  });
});
