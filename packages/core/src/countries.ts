import {
  COUNTRIES,
  LAUNCHED_COUNTRY_CODES,
  SUPPORTED_COUNTRY_CODES,
  type CountryConfig,
} from "@voicedesk/compliance";
import {
  DEFAULT_PLATFORM_SPEND_SETTINGS,
  platformSettings,
  withPlatformAccess,
  type CountrySettings,
  type Database,
} from "@voicedesk/db";
import { eq } from "drizzle-orm";

/**
 * Country launches (ADR 0031). Code ships country packs; a preview pack only opens for
 * sign-ups once the platform owner launches it in Platform admin, after legal review.
 */

export const DEFAULT_COUNTRY_SETTINGS: CountrySettings = { launched: [], smsRegistered: [] };

export async function getCountrySettings(db: Database): Promise<CountrySettings> {
  const [row] = await db
    .select({ countries: platformSettings.countries })
    .from(platformSettings)
    .where(eq(platformSettings.id, "global"));
  return { ...DEFAULT_COUNTRY_SETTINGS, ...(row?.countries ?? {}) };
}

/** Countries businesses can sign up in: launched in code, plus those the owner launched. */
export function launchedCountries(settings: CountrySettings): string[] {
  return SUPPORTED_COUNTRY_CODES.filter(
    (code) => LAUNCHED_COUNTRY_CODES.includes(code) || settings.launched.includes(code),
  );
}

/** Whether business texts may go to a country (US texts need A2P 10DLC registration first). */
export function textsAllowedTo(country: string | null, settings: CountrySettings): boolean {
  const pack: CountryConfig | undefined = country ? COUNTRIES[country] : undefined;
  if (!pack?.sms.registration) return true;
  return settings.smsRegistered.includes(pack.code);
}

/** Platform owner only (callers check): launch countries and record texting registration. */
export async function saveCountrySettings(
  db: Database,
  settings: CountrySettings,
  actorUserId: string,
): Promise<CountrySettings> {
  const clean: CountrySettings = {
    launched: settings.launched.filter((c) => SUPPORTED_COUNTRY_CODES.includes(c)),
    smsRegistered: settings.smsRegistered.filter((c) => SUPPORTED_COUNTRY_CODES.includes(c)),
  };
  await withPlatformAccess(db, { actorUserId, reason: "country launches" }, (tx) =>
    tx
      .insert(platformSettings)
      .values({
        id: "global",
        spend: DEFAULT_PLATFORM_SPEND_SETTINGS,
        countries: clean,
        updatedBy: actorUserId,
      })
      .onConflictDoUpdate({
        target: platformSettings.id,
        set: { countries: clean, updatedBy: actorUserId, updatedAt: new Date() },
      }),
  );
  return clean;
}
