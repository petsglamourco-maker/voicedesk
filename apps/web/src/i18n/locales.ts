export const LOCALES = ["en", "es", "zh", "fr", "ar", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

const RTL: ReadonlySet<Locale> = new Set(["ar"]);

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function directionFor(locale: string): "ltr" | "rtl" {
  return isLocale(locale) && RTL.has(locale) ? "rtl" : "ltr";
}
