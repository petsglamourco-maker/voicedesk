import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyHmacSignature } from "../src/lib/webhooks";

describe("verifyHmacSignature", () => {
  const secret = "whsec_test";
  const payload = '{"event":"call.completed"}';
  const good = createHmac("sha256", secret).update(payload).digest("hex");

  it("accepts a valid signature", () => {
    expect(verifyHmacSignature({ secret, payload, signature: good })).toBe(true);
  });

  it("rejects tampered payloads, wrong secrets and malformed signatures", () => {
    expect(verifyHmacSignature({ secret, payload: payload + " ", signature: good })).toBe(false);
    expect(verifyHmacSignature({ secret: "other", payload, signature: good })).toBe(false);
    expect(verifyHmacSignature({ secret, payload, signature: "not-hex" })).toBe(false);
    expect(verifyHmacSignature({ secret, payload, signature: "" })).toBe(false);
  });

  it("supports base64 sha1 (e.g. Twilio-style)", () => {
    const sig = createHmac("sha1", secret).update(payload).digest("base64");
    expect(
      verifyHmacSignature({
        secret,
        payload,
        signature: sig,
        algorithm: "sha1",
        encoding: "base64",
      }),
    ).toBe(true);
  });
});
