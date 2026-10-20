/**
 * Stops routing a number and removes it (same as Platform admin → Phone numbers → Remove).
 * Release the number at the carrier separately.
 * Usage: pnpm --filter @voicedesk/api number:remove +447700900123
 */
import { loadRootEnv } from "@voicedesk/config/load-env";
import { closeDb, createDb, phoneNumbers, user, withPlatformAccess } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { sipGatewayFromEnv } from "./lib/sip";

loadRootEnv();
const e164 = process.argv[2]?.replace(/[\s()-]/g, "");
if (!e164 || !/^\+[1-9]\d{7,14}$/.test(e164)) {
  console.error("Usage: number:remove <+44... number>");
  process.exit(1);
}
const sip = sipGatewayFromEnv();
if (!sip) {
  console.error("LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET are not set in .env");
  process.exit(1);
}
const db = createDb(process.env.DATABASE_URL!);
try {
  const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.isPlatformOwner, true));
  if (!owner) throw new Error("No platform owner account (run pnpm db:seed)");
  const actor = { actorUserId: owner.id, reason: "remove phone number (script)" };
  const [row] = await withPlatformAccess(db, actor, (tx) =>
    tx.select().from(phoneNumbers).where(eq(phoneNumbers.e164, e164)),
  );
  if (!row) throw new Error(`${e164} isn't registered`);
  await sip.deleteRoute({
    trunkId: row.livekitTrunkId ?? undefined,
    dispatchRuleId: row.livekitDispatchRuleId ?? undefined,
  });
  await withPlatformAccess(db, actor, (tx) =>
    tx.delete(phoneNumbers).where(eq(phoneNumbers.id, row.id)),
  );
  console.log(`Removed ${e164} and its LiveKit routing`);
} catch (error) {
  console.error("Failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb(db);
}
