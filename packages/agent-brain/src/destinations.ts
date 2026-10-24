/**
 * Where outbound calls and texts may go (security audit H3, ADR 0022): only to countries the
 * platform allows (UK by default), and never to premium-rate or special-rate numbers, which
 * are how toll fraud and SMS pumping make money.
 */

/** Calling codes for the countries we can allow. Longest first, so +353 wins over +3. */
const CALLING_CODES: Array<[string, string]> = [
  ["353", "IE"],
  ["44", "GB"],
  ["33", "FR"],
  ["49", "DE"],
  ["34", "ES"],
  ["1", "US"], // also Canada and the Caribbean (NANP); allow deliberately
];

/** Premium, shared-cost and personal numbers (UK). Isle of Man mobiles (+447624) are fine. */
const BLOCKED_PREFIXES = ["+449", "+4487", "+4484", "+4470", "+44118", "+4476"];
const ALLOWED_EXCEPTIONS = ["+447624"];

export function countryOfNumber(e164: string): string | null {
  const digits = e164.replace(/^\+/, "");
  for (const [code, country] of CALLING_CODES) if (digits.startsWith(code)) return country;
  return null;
}

export type DestinationCheck =
  { ok: true } | { ok: false; reason: "invalid" | "country" | "premium" };

export function checkDestination(e164: string, allowedCountries: string[]): DestinationCheck {
  if (!/^\+\d{8,15}$/.test(e164)) return { ok: false, reason: "invalid" };
  const country = countryOfNumber(e164);
  if (!country || !allowedCountries.includes(country)) return { ok: false, reason: "country" };
  if (
    BLOCKED_PREFIXES.some((p) => e164.startsWith(p)) &&
    !ALLOWED_EXCEPTIONS.some((p) => e164.startsWith(p))
  ) {
    return { ok: false, reason: "premium" };
  }
  return { ok: true };
}

export function destinationMessage(reason: "invalid" | "country" | "premium"): string {
  return reason === "invalid"
    ? "That phone number isn't valid"
    : reason === "country"
      ? "Calls and texts to that country aren't allowed"
      : "Premium-rate and special-rate numbers can't be called or texted";
}
