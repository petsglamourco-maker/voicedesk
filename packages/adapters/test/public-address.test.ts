import { describe, expect, it } from "vitest";
import { ImapMailbox } from "../src/email/mailbox";
import { BlockedHostError, isPublicAddress, resolvePublicHost } from "../src/net/public-address";

describe("isPublicAddress (shared SSRF check)", () => {
  it.each([
    ["8.8.8.8", true],
    ["2606:4700::1111", true],
    ["::ffff:8.8.8.8", true],
    ["127.0.0.1", false],
    ["10.0.0.5", false],
    ["169.254.169.254", false],
    ["::1", false],
    ["::ffff:7f00:1", false],
    ["::ffff:a9fe:a9fe", false],
    ["64:ff9b::a9fe:a9fe", false],
    ["2002:a9fe:a9fe::1", false],
    ["fd12::1", false],
    ["not-an-ip", false],
  ])("%s → %s", (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected);
  });
});

describe("resolvePublicHost", () => {
  it("refuses internal names and literals", async () => {
    await expect(resolvePublicHost("localhost")).rejects.toBeInstanceOf(BlockedHostError);
    await expect(resolvePublicHost("127.0.0.1")).rejects.toBeInstanceOf(BlockedHostError);
    await expect(resolvePublicHost("[::ffff:7f00:1]")).rejects.toBeInstanceOf(BlockedHostError);
  });

  it("accepts a public literal", async () => {
    await expect(resolvePublicHost("8.8.8.8")).resolves.toEqual({ address: "8.8.8.8", family: 4 });
  });
});

describe("ImapMailbox", () => {
  it("never connects to an internal mail host (checked before any connection)", async () => {
    const box = new ImapMailbox({
      imap: { host: "localhost", port: 993, secure: true },
      smtp: { host: "localhost", port: 465, secure: true },
      username: "a@example.com",
      password: "x",
    });
    const error = await box.verify().catch((e: unknown) => e);
    expect((error as { cause?: unknown }).cause).toBeInstanceOf(BlockedHostError);
  });
});
