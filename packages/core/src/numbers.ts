import {
  DEFAULT_PLATFORM_SPEND_SETTINGS,
  platformSettings,
  withPlatformAccess,
  type Database,
  type NumberSettings,
} from "@voicedesk/db";
import { eq } from "drizzle-orm";

/**
 * Automatic number purchases (ADR 0032). They cost money, so they're off until the platform
 * owner switches them on, with a daily limit and a most-numbers-per-business ceiling.
 */
export const DEFAULT_NUMBER_SETTINGS: NumberSettings = {
  autoBuy: false,
  dailyLimit: 5,
  perBusiness: 10,
};

export async function getNumberSettings(db: Database): Promise<NumberSettings> {
  const [row] = await db
    .select({ numbers: platformSettings.numbers })
    .from(platformSettings)
    .where(eq(platformSettings.id, "global"));
  return { ...DEFAULT_NUMBER_SETTINGS, ...(row?.numbers ?? {}) };
}

/** Platform owner only (callers check). */
export async function saveNumberSettings(
  db: Database,
  settings: NumberSettings,
  actorUserId: string,
): Promise<void> {
  await withPlatformAccess(db, { actorUserId, reason: "number purchase settings" }, (tx) =>
    tx
      .insert(platformSettings)
      .values({
        id: "global",
        spend: DEFAULT_PLATFORM_SPEND_SETTINGS,
        numbers: settings,
        updatedBy: actorUserId,
      })
      .onConflictDoUpdate({
        target: platformSettings.id,
        set: { numbers: settings, updatedBy: actorUserId, updatedAt: new Date() },
      }),
  );
}
