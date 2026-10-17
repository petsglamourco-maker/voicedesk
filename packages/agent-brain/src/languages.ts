export const LANGUAGES = ["en", "es", "zh", "fr", "ar", "de"] as const;
export type Lang = (typeof LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<Lang, string> = {
  en: "English",
  es: "Spanish",
  zh: "Mandarin Chinese (Simplified)",
  fr: "French",
  ar: "Arabic",
  de: "German",
};

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

export function toLang(value: string | null | undefined, fallback: Lang = "en"): Lang {
  return isLang(value) ? value : fallback;
}
