import { randomInt } from "node:crypto";
import {
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/max";

// Excludes look-alikes (0/O, 1/I/L) so references are easy to read out and type.
const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Human-friendly reference, e.g. "BD-7K4Q" for "Bright Dental". */
export function makeReference(businessName: string): string {
  const initials =
    businessName
      .split(/\s+/)
      .map((w) => w.replace(/[^A-Za-z]/g, "")[0] ?? "")
      .join("")
      .toUpperCase()
      .slice(0, 2) || "VD";
  let code = "";
  for (let i = 0; i < 4; i++) code += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return `${initials.padEnd(2, "X")}-${code}`;
}

/**
 * A phone number as typed (national or international) to E.164 for the business's country
 * (ADR 0031: libphonenumber, every country pack). Lenient on purpose: a number of a
 * possible length is accepted even if its range isn't in service yet; the send guard decides
 * where calls and texts may go.
 */
export function normalisePhone(raw: string, countryCode: string): string | null {
  const parsed = parsePhoneNumberFromString(raw.trim(), countryCode.toUpperCase() as CountryCode);
  if (!parsed?.isPossible()) return null;
  return parsed.number;
}

/** Digits grouped the way people say them in that country, e.g. "07700 900123". */
export function groupDigitsForReadback(e164: string, countryCode: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  // Callers hear numbers from their own calling code in the national form, others in full.
  const home = getCountryCallingCode(countryCode.toUpperCase() as CountryCode);
  const formatted =
    parsed.countryCallingCode === home ? parsed.formatNational() : parsed.formatInternational();
  // Long runs are hard to say back: "900123" becomes "900 123".
  return formatted.replace(/\d{6,}/g, (run) => run.replace(/(\d{3})(?=\d)/g, "$1 "));
}
