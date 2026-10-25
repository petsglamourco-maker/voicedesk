import {
  aiProviders,
  calendarConnections,
  mailboxes,
  withPlatformAccess,
  type Database,
} from "@voicedesk/db";
import { eq, inArray } from "drizzle-orm";
import type { SecretBox } from "./secret-box";

/**
 * Re-encrypts every stored secret with the current key after a key rotation (security audit
 * M12). Values already on the current key are left alone; values no configured key can read
 * are counted, never logged. Runs under audited platform access.
 */
export interface ReencryptReport {
  rotated: number;
  current: number;
  unreadable: number;
}

export async function reencryptAll(
  db: Database,
  box: SecretBox,
  actorUserId: string,
  options: { tenants?: string[]; includeProviders?: boolean } = {},
): Promise<ReencryptReport> {
  const report: ReencryptReport = { rotated: 0, current: 0, unreadable: 0 };
  const reseal = (value: string, context: string): string | null => {
    if (!box.needsRotation(value)) {
      report.current++;
      return null;
    }
    try {
      const next = box.encrypt(box.decrypt(value, context), context);
      report.rotated++;
      return next;
    } catch {
      report.unreadable++;
      return null;
    }
  };

  await withPlatformAccess(
    db,
    { actorUserId, reason: "re-encrypt secrets (key rotation)" },
    async (tx) => {
      if (options.includeProviders !== false) {
        for (const row of await tx.select().from(aiProviders)) {
          if (!row.apiKeyEncrypted) continue;
          const next = reseal(row.apiKeyEncrypted, `ai_providers:${row.key}`);
          if (next)
            await tx
              .update(aiProviders)
              .set({ apiKeyEncrypted: next })
              .where(eq(aiProviders.id, row.id));
        }
      }
      const calendars = await tx
        .select()
        .from(calendarConnections)
        .where(
          options.tenants ? inArray(calendarConnections.tenantId, options.tenants) : undefined,
        );
      for (const row of calendars) {
        const next = reseal(
          row.refreshTokenEncrypted,
          `calendar_connections:${row.tenantId}:${row.provider}`,
        );
        if (next) {
          await tx
            .update(calendarConnections)
            .set({ refreshTokenEncrypted: next })
            .where(eq(calendarConnections.id, row.id));
        }
      }
      const boxes = await tx
        .select()
        .from(mailboxes)
        .where(options.tenants ? inArray(mailboxes.tenantId, options.tenants) : undefined);
      for (const row of boxes) {
        const next = reseal(row.passwordEncrypted, `mailboxes:${row.tenantId}`);
        if (next)
          await tx
            .update(mailboxes)
            .set({ passwordEncrypted: next })
            .where(eq(mailboxes.id, row.id));
      }
    },
  );
  return report;
}
