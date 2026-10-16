import { randomUUID } from "node:crypto";
import { loadRootEnv, requireEnv } from "@voicedesk/config/load-env";
import { describe, expect, it } from "vitest";
import { SmtpEmailProvider } from "../src/email/smtp";
import { MockEmailProvider } from "../src/mocks";

loadRootEnv();

const MAILPIT_API = "http://localhost:8025/api/v1";

describe("MockEmailProvider", () => {
  it("records sent messages", async () => {
    const mock = new MockEmailProvider();
    const { id } = await mock.send({ to: "a@example.com", subject: "Hi", text: "Body" });
    expect(mock.sent).toEqual([expect.objectContaining({ id, subject: "Hi" })]);
  });
});

describe("SmtpEmailProvider (local Mailpit)", () => {
  it("delivers a message that can be read back from the inbox", async () => {
    const provider = new SmtpEmailProvider({
      host: requireEnv("SMTP_HOST"),
      port: Number(requireEnv("SMTP_PORT")),
      defaultFrom: requireEnv("EMAIL_FROM"),
    });
    const subject = `contract-test ${randomUUID()}`;
    await provider.send({ to: "contract@example.com", subject, text: "Hello from the test" });

    const res = await fetch(
      `${MAILPIT_API}/search?query=${encodeURIComponent(`subject:"${subject}"`)}`,
    );
    const body = (await res.json()) as { messages: Array<{ Subject: string }> };
    expect(body.messages.map((m) => m.Subject)).toContain(subject);
  });
});
