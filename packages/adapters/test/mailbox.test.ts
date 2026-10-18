import { describe, expect, it } from "vitest";
import { MAILBOX_PRESETS, stripQuoted } from "../src/email/mailbox";

describe("stripQuoted", () => {
  it("keeps the new message and drops quoted history", () => {
    const gmail =
      "Can I move my appointment to Friday?\n\nThanks,\nSam\n\nOn Mon, 19 Oct 2026 at 09:00, Bright Dental <hi@bright.example> wrote:\n> Your booking is confirmed.\n> See you soon";
    expect(stripQuoted(gmail)).toBe("Can I move my appointment to Friday?\n\nThanks,\nSam");
    const outlook =
      "Yes please.\r\n\r\nFrom: Bright Dental <hi@bright.example>\r\nSent: Monday, 19 October 2026 09:00\r\nTo: Sam\r\nSubject: Booking";
    expect(stripQuoted(outlook)).toBe("Yes please.");
    expect(stripQuoted("> only quoted")).toBe("");
  });
});

describe("MAILBOX_PRESETS", () => {
  it("covers the common providers with TLS settings", () => {
    expect(MAILBOX_PRESETS.gmail).toEqual({
      imap: { host: "imap.gmail.com", port: 993, secure: true },
      smtp: { host: "smtp.gmail.com", port: 465, secure: true },
    });
  });
});
