import { randomUUID } from "node:crypto";
import { MockEmbeddingProvider, MockLlmProvider } from "@voicedesk/adapters";
import type { InboundEmail, OutgoingEmail } from "@voicedesk/adapters/email/mailbox";
import { channelThreads, closeDb, contacts, conversationMessages, withTenant } from "@voicedesk/db";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  emailThreadKey,
  processInboundEmail,
  replySubject,
  sendAssistantEmail,
} from "../src/email";

let dbs: TestDbs;
let tenantId: string;

beforeAll(async () => {
  dbs = connectTestDbs();
  tenantId = await createTestTenant(dbs.app, "Email Triage Co");
});
afterAll(async () => {
  await closeDb(dbs.app);
  await closeDb(dbs.owner);
});

function email(over: Partial<InboundEmail> = {}): InboundEmail {
  return {
    uid: 1,
    messageId: `<${randomUUID()}@mail.example>`,
    inReplyTo: null,
    references: [],
    from: { address: `cust-${randomUUID().slice(0, 6)}@example.com`, name: "Sam Patel" },
    subject: "Opening hours",
    text: "Hi, what time do you open on Saturday?",
    date: new Date(),
    automated: false,
    authenticated: true,
    attachmentNames: [],
    ...over,
  };
}

function fakeClient() {
  const sent: OutgoingEmail[] = [];
  return {
    sent,
    client: {
      send: (m: OutgoingEmail) => {
        sent.push(m);
        return Promise.resolve({ messageId: "<x>" });
      },
    },
  };
}

const deps = (llm: MockLlmProvider) => ({
  db: dbs.app,
  llm,
  embeddings: new MockEmbeddingProvider(),
});

async function lastAgentMessage(threadId: string) {
  return withTenant(dbs.app, tenantId, async (tx) => {
    const [thread] = await tx.select().from(channelThreads).where(eq(channelThreads.id, threadId));
    const [msg] = await tx
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, thread!.conversationId!),
          eq(conversationMessages.role, "agent"),
        ),
      )
      .orderBy(desc(conversationMessages.id))
      .limit(1);
    return { thread: thread!, msg: msg! };
  });
}

describe("email triage", () => {
  it("ignores automated mail", async () => {
    const { client, sent } = fakeClient();
    const res = await processInboundEmail(deps(new MockLlmProvider()), {
      tenantId,
      autoSend: true,
      client,
      email: email({ automated: true }),
    });
    expect(res).toEqual({ status: "skipped", reason: "automated" });
    expect(sent).toEqual([]);
  });

  it("keeps a draft for approval by default, linked to a contact", async () => {
    const { client, sent } = fakeClient();
    const llm = new MockLlmProvider().enqueue(
      MockLlmProvider.text("Hello Sam, we open at 9am on Saturdays."),
    );
    const incoming = email();
    const res = await processInboundEmail(deps(llm), {
      tenantId,
      autoSend: false,
      client,
      email: incoming,
    });
    expect(res.status).toBe("draft");
    expect(sent).toEqual([]);
    const { thread, msg } = await lastAgentMessage((res as { threadId: string }).threadId);
    expect(thread.needsHuman).toBe(true);
    expect(msg.metadata).toMatchObject({ draft: true });
    const [contact] = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(contacts).where(eq(contacts.email, incoming.from.address)),
    );
    expect(contact).toMatchObject({ fullName: "Sam Patel", source: "email" });
    expect(thread.contactId).toBe(contact!.id);

    // Approving sends it as the assistant, threaded, with the AI signature.
    await sendAssistantEmail(dbs.app, tenantId, thread.id, client, msg.content);
    expect(sent[0]).toMatchObject({
      to: incoming.from.address,
      subject: "Re: Opening hours",
      inReplyTo: incoming.messageId,
      references: [incoming.messageId],
    });
    expect(sent[0]!.text).toMatch(/we open at 9am[\s\S]*--\nAmelia\nAI assistant, /);
    const after = await lastAgentMessage(thread.id);
    expect(after.msg.metadata).toMatchObject({ draft: false });
    expect(after.thread.needsHuman).toBe(false);
  });

  it("auto-sends simple answers, but not when the assistant had to say it didn't know", async () => {
    const { client, sent } = fakeClient();
    const simple = new MockLlmProvider().enqueue(MockLlmProvider.text("We open at 9am."));
    const ok = await processInboundEmail(deps(simple), {
      tenantId,
      autoSend: true,
      client,
      email: email(),
    });
    expect(ok.status).toBe("sent");
    expect(sent).toHaveLength(1);

    const unsure = new MockLlmProvider().enqueue(
      MockLlmProvider.toolUse("note_unanswered_question", { question: "Do you take Medisure?" }),
      MockLlmProvider.text("I'll check with the team and get back to you."),
    );
    const held = await processInboundEmail(deps(unsure), {
      tenantId,
      autoSend: true,
      client,
      email: email({ subject: "Insurance", text: "Do you accept Medisure?" }),
    });
    expect(held).toMatchObject({ status: "draft", reason: "needs a person" });
    expect(sent).toHaveLength(1);
  });

  it("never auto-replies to a sender the mail server couldn't verify (audit M14)", async () => {
    const { client, sent } = fakeClient();
    const llm = new MockLlmProvider().enqueue(MockLlmProvider.text("We open at 9am."));
    const held = await processInboundEmail(deps(llm), {
      tenantId,
      autoSend: true,
      client,
      email: email({ authenticated: false }),
    });
    expect(held).toMatchObject({ status: "draft", reason: "sender not verified" });
    expect(sent).toHaveLength(0);
  });

  it("keeps replies in the same thread", () => {
    const first = email();
    const reply = email({
      from: first.from,
      subject: "Re: Opening hours",
      inReplyTo: first.messageId,
      references: [first.messageId!],
    });
    expect(emailThreadKey(reply)).toBe(emailThreadKey(first));
    expect(replySubject("Re: Opening hours")).toBe("Re: Opening hours");
    expect(replySubject("")).toBe("Re: your message");
  });
});
