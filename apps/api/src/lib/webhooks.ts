import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Constant-time HMAC verification for inbound webhooks. Each provider adapter (Twilio,
 * Meta, Stripe...) wraps this with its own canonicalisation and header format; every
 * webhook route MUST verify before parsing or acting on the payload.
 */
export function verifyHmacSignature(params: {
  secret: string;
  payload: string | Buffer;
  signature: string;
  algorithm?: "sha1" | "sha256";
  encoding?: "hex" | "base64";
}): boolean {
  const { secret, payload, signature, algorithm = "sha256", encoding = "hex" } = params;
  const expected = createHmac(algorithm, secret).update(payload).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, encoding);
  } catch {
    return false;
  }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
