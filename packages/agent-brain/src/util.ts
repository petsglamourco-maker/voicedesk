import { randomInt } from "node:crypto";

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
 * Light phone normalisation to E.164 for a business country. Full libphonenumber
 * validation arrives with contacts (Phase 3).
 */
export function normalisePhone(raw: string, countryCode: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return /^\+\d{8,15}$/.test(digits) ? digits : null;
  if (digits.startsWith("00")) return normalisePhone(`+${digits.slice(2)}`, countryCode);
  const prefix: Record<string, string> = {
    GB: "44",
    IE: "353",
    FR: "33",
    DE: "49",
    ES: "34",
    US: "1",
  };
  const cc = prefix[countryCode];
  if (!cc) return null;
  const national = digits.replace(/^0/, "");
  const e164 = `+${cc}${national}`;
  return /^\+\d{8,15}$/.test(e164) ? e164 : null;
}

/** Digits grouped for reading back aloud, e.g. "07700 900 123". */
export function groupDigitsForReadback(e164: string, countryCode: string): string {
  const national =
    countryCode === "GB" && e164.startsWith("+44") ? `0${e164.slice(3)}` : e164.replace(/^\+/, "+");
  const d = national.replace(/[^\d+]/g, "");
  if (d.length === 11 && d.startsWith("0"))
    return `${d.slice(0, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return d.replace(/(\d{3})(?=\d)/g, "$1 ");
}
