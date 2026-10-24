import { processedMessages, withTenant, type Database } from "@voicedesk/db";

/**
 * Claims an inbound message so it's handled once, however many times the provider delivers
 * it (security audit M6). True for the first delivery, false for a repeat.
 */
export async function claimInbound(
  db: Database,
  tenantId: string,
  channel: "whatsapp" | "form",
  externalId: string,
): Promise<boolean> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .insert(processedMessages)
      .values({ tenantId, channel, externalId: externalId.slice(0, 200) })
      .onConflictDoNothing()
      .returning({ id: processedMessages.id }),
  );
  return rows.length > 0;
}
