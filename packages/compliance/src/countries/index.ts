import { au } from "./au";
import { ca } from "./ca";
import { gb } from "./gb";
import { ie } from "./ie";
import { nz } from "./nz";
import type { CountryConfig } from "./types";
import { us } from "./us";

export type * from "./types";

/**
 * Country packs (ADR 0031). A pack being here doesn't open sign-ups there: only launched
 * packs, and those the platform owner launches in Platform admin, can be chosen.
 */
export const COUNTRIES: Readonly<Record<string, CountryConfig>> = {
  GB: gb,
  IE: ie,
  US: us,
  CA: ca,
  AU: au,
  NZ: nz,
};

export const SUPPORTED_COUNTRY_CODES = Object.keys(COUNTRIES);

/** Countries launched in code (the platform owner can launch preview ones on top). */
export const LAUNCHED_COUNTRY_CODES = SUPPORTED_COUNTRY_CODES.filter(
  (code) => COUNTRIES[code]!.status === "launched",
);

export function getCountryConfig(code: string): CountryConfig {
  const config = COUNTRIES[code.toUpperCase()];
  if (!config) throw new Error(`Country ${code} is not supported yet`);
  return config;
}

/** The pack for a country code, or null when we have none. */
export function findCountryConfig(code: string | null | undefined): CountryConfig | null {
  return code ? (COUNTRIES[code.toUpperCase()] ?? null) : null;
}
