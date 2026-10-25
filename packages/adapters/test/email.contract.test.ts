import { randomUUID } from "node:crypto";
import { loadRootEnv } from "@voicedesk/config/load-env";
import { describe, expect, it } from "vitest";
import { isReservedAddress, ReservedDomainRouter, SmtpEmailProvider } from "../src/email/smtp";
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

describe("reserved test/demo addresses", () => {
  it("recognises domains that can never receive real mail", () => {
    for (const a of [
      "owner-1@example.com",
      "x@mail.example.org",
      "sms+447700900123@sms.local",
      "a@shop.test",
      "b@nowhere.invalid",
      "c@localhost",
    ])
      expect(isReservedAddress(a), a).toBe(true);
    for (const a of ["someone@gmail.com", "hi@examples.com", "x@example.co.uk"])
      expect(isReservedAddress(a), a).toBe(false);
  });

  it("sends real recipients out and keeps reserved ones in the local inbox", async () => {
    const real = new MockEmailProvider();
    const local = new MockEmailProvider();
    const router = new ReservedDomainRouter(real, local);
    await router.send({ to: ["owner@example.com", "boss@gmail.com"], subject: "S", text: "T" });
    await router.send({ to: "only@shop.test", subject: "S2", text: "T" });
    expect(real.sent.map((m) => m.to)).toEqual([["boss@gmail.com"]]);
    expect(local.sent.map((m) => m.to)).toEqual([["owner@example.com"], ["only@shop.test"]]);
  });
});

describe("SmtpEmailProvider (local Mailpit)", () => {
  it("delivers a message that can be read back from the inbox", async () => {
    const provider = new SmtpEmailProvider({
      // Always the local Mailpit, never the real email service configured in .env.
      host: process.env.MAILPIT_SMTP_HOST || "localhost",
      port: Number(process.env.MAILPIT_SMTP_PORT || 1025),
      defaultFrom: "VoiceDesk <no-reply@voicedesk.local>",
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
