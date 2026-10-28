import { findCountryConfig, SUPPORTED_COUNTRY_CODES } from "@voicedesk/compliance";
import {
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/max";

/**
 * Where outbound calls and texts may go (security audit H3, ADR 0022, ADR 0031): only to
 * countries the platform allows (UK by default), and never to premium-rate, shared-cost,
 * personal or pager numbers, which are how toll fraud and SMS pumping make money.
 */

/** The Crown Dependencies share +44 and count as the UK for the allow-list. */
const SAME_AS: Record<string, string> = { IM: "GB", JE: "GB", GG: "GB" };

/** Number types that cost the caller extra or route to someone else (libphonenumber). */
const BLOCKED_TYPES = new Set(["PREMIUM_RATE", "SHARED_COST", "PERSONAL_NUMBER", "PAGER"]);

/**
 * The country a number belongs to (ISO code), or null when it can't be told. +1 numbers are
 * split by area code into the US, Canada and the Caribbean, where toll fraud is common, so a
 * Caribbean number is never mistaken for a US one.
 */
export function countryOfNumber(e164: string): string | null {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return null;
  if (parsed.country) return SAME_AS[parsed.country] ?? parsed.country;
  // A range not yet in the library (or a test range like Ofcom's 07700 900xxx): fall back to
  // the country pack with that calling code. Never for +1, which many countries share.
  if (parsed.countryCallingCode === "1") return null;
  return (
    SUPPORTED_COUNTRY_CODES.find(
      (code) => getCountryCallingCode(code as CountryCode) === parsed.countryCallingCode,
    ) ?? null
  );
}

export type DestinationCheck =
  { ok: true } | { ok: false; reason: "invalid" | "country" | "premium" };

export function checkDestination(e164: string, allowedCountries: string[]): DestinationCheck {
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- reviewed: anchored/bounded pattern without nested quantifiers: linear time
  if (!/^\+\d{8,15}$/.test(e164)) return { ok: false, reason: "invalid" };
  const country = countryOfNumber(e164);
  if (!country || !allowedCountries.includes(country)) return { ok: false, reason: "country" };
  const pack = findCountryConfig(country);
  const exception = pack?.premiumExceptions?.some((p) => e164.startsWith(p)) ?? false;
  const listed = pack?.premiumPrefixes.some((p) => e164.startsWith(p)) ?? false;
  const type = parsePhoneNumberFromString(e164)?.getType();
  if (!exception && (listed || (type !== undefined && BLOCKED_TYPES.has(type)))) {
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
