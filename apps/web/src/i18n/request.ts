import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale } from "./locales";

// UI locale comes from a cookie for now (no locale-prefixed routes). Only English
// messages exist in Phase 0; other locales fall back to English until translated.
export default getRequestConfig(async () => {
  const requested = (await cookies()).get("locale")?.value;
  const locale = requested && isLocale(requested) ? requested : DEFAULT_LOCALE;
  const messages = (await import(`../../messages/en.json`)) as { default: Record<string, unknown> };
  return { locale, messages: messages.default };
});
