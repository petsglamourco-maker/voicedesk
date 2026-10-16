import { gb } from "./gb";
import type { CountryConfig } from "./types";

export type * from "./types";

/** Countries with a reviewed-enough config to onboard tenants. Add IE, FR, DE, ES, US... next. */
export const COUNTRIES: Readonly<Record<string, CountryConfig>> = { GB: gb };

export const SUPPORTED_COUNTRY_CODES = Object.keys(COUNTRIES);

export function getCountryConfig(code: string): CountryConfig {
  const config = COUNTRIES[code.toUpperCase()];
  if (!config) throw new Error(`Country ${code} is not supported yet`);
  return config;
}
