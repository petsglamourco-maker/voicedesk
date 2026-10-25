import { describe, expect, it } from "vitest";
import { senderAuthenticated } from "../src/email/mailbox";

/** Auto-replies only to senders the receiving server verified (security audit M14). */
describe("senderAuthenticated", () => {
  const gmail = (r: string) => [`mx.google.com; ${r}`];
  it("accepts DMARC pass, or DKIM pass for the sender's own domain", () => {
    expect(
      senderAuthenticated(
        gmail(
          "dkim=pass header.i=@shop.example; spf=pass; dmarc=pass (p=REJECT) header.from=shop.example",
        ),
        "sam@shop.example",
      ),
    ).toBe(true);
    expect(
      senderAuthenticated(
        gmail("dkim=pass header.d=shop.example; spf=neutral"),
        "sam@mail.shop.example",
      ),
    ).toBe(true);
  });
  it("refuses missing results, failures and someone else's signature", () => {
    expect(senderAuthenticated([], "sam@shop.example")).toBe(false);
    expect(senderAuthenticated(gmail("dkim=fail; spf=fail; dmarc=fail"), "sam@shop.example")).toBe(
      false,
    );
    expect(
      senderAuthenticated(
        gmail("dkim=pass header.d=spammer.example; dmarc=none"),
        "ceo@bank.example",
      ),
    ).toBe(false);
    // SPF alone isn't enough (the From address can still be forged).
    expect(
      senderAuthenticated(gmail("spf=pass smtp.mailfrom=bounce.example"), "ceo@bank.example"),
    ).toBe(false);
  });
  it("only trusts the topmost header (added by the receiving server)", () => {
    expect(
      senderAuthenticated(["mx.example; dmarc=fail", "forged; dmarc=pass"], "a@b.example"),
    ).toBe(false);
  });
});
