import { randomUUID } from "node:crypto";
import { MockEmbeddingProvider, MockLlmProvider } from "@voicedesk/adapters";
import type {
  MailboxClient,
  MailboxCredentials,
  OutgoingEmail,
} from "@voicedesk/adapters/email/mailbox";
import { processInboundEmail } from "@voicedesk/agent-brain";
import { mailboxes, withTenant } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, createOwnerWithTenant, ORIGIN, type TestHarness } from "./harness";
import { readableError } from "../src/routes/mailbox";

const sent: OutgoingEmail[] = [];
const logins: MailboxCredentials[] = [];
const fakeClient = (creds: MailboxCredentials): MailboxClient => ({
  verify: () => {
    logins.push(creds);
    return creds.password === "wrong"
      ? Promise.reject(new Error("IMAP login failed: Invalid credentials"))
      : Promise.resolve();
  },
  fetchNew: () => Promise.resolve({ uidValidity: 1, lastUid: 0, messages: [] }),
  send: (message) => {
    sent.push(message);
    return Promise.resolve({ messageId: "<sent>" });
  },
});

let h: TestHarness;
let biz: Awaited<ReturnType<typeof createOwnerWithTenant>>;

beforeAll(async () => {
  h = await createHarness({ mailboxClient: fakeClient });
  biz = await createOwnerWithTenant(h, "Email Co");
});
afterAll(() => h.close());

const headers = () => ({ cookie: biz.cookie, origin: ORIGIN });
const url = (path = "") => `/api/tenants/${biz.tenantId}/mailbox${path}`;
const settings = {
  emailAddress: "Help@Email.example",
  username: "help@email.example",
  imap: { host: "imap.gmail.com", port: 993, secure: true },
  smtp: { host: "smtp.gmail.com", port: 465, secure: true },
  folder: "INBOX",
  autoSend: false,
};

describe("mailbox security (audit H2)", () => {
  it("only accepts standard mail ports", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: url(),
      headers: headers(),
      payload: {
        ...settings,
        password: "x",
        imap: { host: "imap.gmail.com", port: 6379, secure: false },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("explains failures without echoing raw server errors", () => {
    const blocked = Object.assign(new Error("That host isn't on the public internet"), {
      name: "BlockedHostError",
    });
    expect(readableError(new Error("IMAP login failed", { cause: blocked }))).toMatch(
      /isn't allowed/,
    );
    expect(readableError(Object.assign(new Error("x"), { code: "EAUTH" }))).toMatch(/app password/);
    const raw = readableError(new Error("connect ECONNREFUSED 10.0.0.7:6379 -ERR redis banner"));
    expect(raw).not.toMatch(/10\.0\.0\.7|6379|redis/);
  });
});

describe("mailbox settings", () => {
  it("logs in before saving, never returns the password, and starts polling", async () => {
    const bad = await h.app.inject({
      method: "PUT",
      url: url(),
      headers: headers(),
      payload: { ...settings, password: "wrong" },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: "MAILBOX_LOGIN_FAILED" });

    const ok = await h.app.inject({
      method: "PUT",
      url: url(),
      headers: headers(),
      payload: { ...settings, password: "app-password" },
    });
    expect(ok.statusCode).toBe(200);
    const id = ok.json<{ mailbox: { id: string } }>().mailbox.id;
    expect(h.jobs.mailboxes).toContainEqual([id, true]);

    const view = await h.app.inject({ method: "GET", url: url(), headers: headers() });
    expect(view.json()).toMatchObject({
      mailbox: { emailAddress: "help@email.example", autoSend: false, status: "active" },
      presets: { gmail: { imap: { host: "imap.gmail.com" } } },
    });
    expect(view.body).not.toContain("app-password");
    const [row] = await withTenant(h.db, biz.tenantId, (tx) =>
      tx.select().from(mailboxes).where(eq(mailboxes.id, id)),
    );
    expect(row!.passwordEncrypted).not.toContain("app-password");

    // Updating without a password keeps (and re-tests) the stored one.
    const update = await h.app.inject({
      method: "PUT",
      url: url(),
      headers: headers(),
      payload: { ...settings, autoSend: true },
    });
    expect(update.json()).toMatchObject({ mailbox: { autoSend: true } });
    expect(logins.at(-1)!.password).toBe("app-password");
  });

  it("approves drafts and sends staff replies in the customer's email thread", async () => {
    const llm = new MockLlmProvider().enqueue(MockLlmProvider.text("We open at 9am."));
    const messageId = `<${randomUUID()}@customer.example>`;
    const outcome = await processInboundEmail(
      { db: h.db, llm, embeddings: new MockEmbeddingProvider() },
      {
        tenantId: biz.tenantId,
        autoSend: false,
        client: { send: () => Promise.reject(new Error("should not send")) },
        email: {
          uid: 1,
          messageId,
          inReplyTo: null,
          references: [],
          from: { address: "sam@customer.example", name: "Sam" },
          subject: "Hours",
          text: "When do you open?",
          date: new Date(),
          automated: false,
          authenticated: true,
          attachmentNames: [],
        },
      },
    );
    expect(outcome.status).toBe("draft");
    const threadId = (outcome as { threadId: string }).threadId;
    const inbox = `/api/tenants/${biz.tenantId}/inbox/${threadId}`;

    const thread = await h.app.inject({ method: "GET", url: inbox, headers: headers() });
    const messages = thread.json<{ messages: Array<{ role: string; draft: boolean }> }>().messages;
    expect(messages.at(-1)).toMatchObject({ role: "agent", draft: true });

    const approve = await h.app.inject({
      method: "POST",
      url: `${inbox}/send-draft`,
      headers: headers(),
      payload: { text: "We open at 9am, Monday to Saturday." },
    });
    expect(approve.json()).toEqual({ sent: true });
    expect(sent.at(-1)).toMatchObject({
      to: "sam@customer.example",
      subject: "Re: Hours",
      inReplyTo: messageId,
    });
    expect(sent.at(-1)!.text).toMatch(
      /^We open at 9am, Monday to Saturday\.\n\n--\n.+\nAI assistant, Email Co/,
    );

    const reply = await h.app.inject({
      method: "POST",
      url: `${inbox}/reply`,
      headers: headers(),
      payload: { text: "Also, we have parking." },
    });
    expect(reply.json()).toEqual({ sent: true });
    expect(sent.at(-1)!.text).toMatch(/^Also, we have parking\.\n\n--\n.+\nEmail Co$/);
  });

  it("disconnects and stops polling", async () => {
    const res = await h.app.inject({ method: "DELETE", url: url(), headers: headers() });
    expect(res.json()).toEqual({ deleted: true });
    expect(h.jobs.mailboxes.at(-1)![1]).toBe(false);
    const view = await h.app.inject({ method: "GET", url: url(), headers: headers() });
    expect(view.json()).toMatchObject({ mailbox: null });
  });
});
