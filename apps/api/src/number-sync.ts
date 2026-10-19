/**
 * Rebuilds the LiveKit routing (inbound trunk + dispatch rule) for every active number, e.g.
 * after changing SIP_AUTH_USERNAME / SIP_AUTH_PASSWORD. Usage: pnpm --filter @voicedesk/api number:sync
 */
import { loadRootEnv } from "@voicedesk/config/load-env";
import { closeDb, createDb, phoneNumbers, user, withPlatformAccess } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { carrierOf } from "./lib/phone-numbers";
import { sipGatewayFromEnv } from "./lib/sip";

loadRootEnv();
const sip = sipGatewayFromEnv();
if (!sip) {
  console.error("LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET are not set in .env");
  process.exit(1);
}
const db = createDb(process.env.DATABASE_URL!);
try {
  const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.isPlatformOwner, true));
  if (!owner) throw new Error("No platform owner account (run pnpm db:seed)");
  const actor = { actorUserId: owner.id, reason: "resync phone number routing" };
  const rows = await withPlatformAccess(db, actor, (tx) =>
    tx.select().from(phoneNumbers).where(eq(phoneNumbers.status, "active")),
  );
  console.log(
    `SIP auth ${process.env.SIP_AUTH_USERNAME && process.env.SIP_AUTH_PASSWORD ? "on" : "off"}; ${rows.length} number(s)`,
  );
  for (const row of rows) {
    await sip.deleteRoute({
      trunkId: row.livekitTrunkId ?? undefined,
      dispatchRuleId: row.livekitDispatchRuleId ?? undefined,
    });
    const route = await sip.createRoute({
      carrier: carrierOf(row),
      e164: row.e164,
      metadata: { tenantId: row.tenantId, phoneNumberId: row.id },
    });
    await withPlatformAccess(db, actor, (tx) =>
      tx
        .update(phoneNumbers)
        .set({ livekitTrunkId: route.trunkId, livekitDispatchRuleId: route.dispatchRuleId })
        .where(eq(phoneNumbers.id, row.id)),
    );
    console.log(`  ${row.e164}: trunk ${route.trunkId}, rule ${route.dispatchRuleId}`);
  }
} catch (error) {
  console.error("Failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb(db);
}
