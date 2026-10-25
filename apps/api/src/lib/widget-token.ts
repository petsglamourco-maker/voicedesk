import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Website chat token (security audit M3): the chat frame carries a short-lived token signed
 * for its widget key. The frame is only served inside the business's allowed sites
 * (frame-ancestors, enforced by the browser), so the chat API trusts the token instead of an
 * origin the request claims. Signed with a key derived from the server secret, so it can't be
 * confused with other signed values.
 */
export const WIDGET_TOKEN_SECONDS = 2 * 60 * 60;

function signingKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("voicedesk:widget-token:v1").digest();
}

function mac(secret: string, widgetKey: string, expires: number): string {
  return createHmac("sha256", signingKey(secret))
    .update(`${widgetKey}.${expires}`)
    .digest("base64url");
}

export function signWidgetToken(secret: string, widgetKey: string, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + WIDGET_TOKEN_SECONDS;
  return `${expires}.${mac(secret, widgetKey, expires)}`;
}

export function verifyWidgetToken(
  secret: string,
  widgetKey: string,
  token: string | undefined,
  now = Date.now(),
): boolean {
  const [exp, sig] = (token ?? "").split(".");
  const expires = Number(exp);
  if (!sig || !Number.isInteger(expires) || expires * 1000 < now) return false;
  const expected = Buffer.from(mac(secret, widgetKey, expires));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
