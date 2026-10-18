/**
 * Registers a Twilio number and routes it to a business (same as Platform admin → Phone
 * numbers → Add). Usage: pnpm --filter @voicedesk/api number:add +447700900123 <tenantId> [label]
 */
import { loadRootEnv } from "@voicedesk/config/load-env";
import { closeDb, createDb, user } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { registerPhoneNumber } from "./lib/phone-numbers";
import { sipGatewayFromEnv } from "./lib/sip";

loadRootEnv();
const [rawNumber, tenantId, label] = process.argv.slice(2);
const e164 = rawNumber?.replace(/[\s()-]/g, "");
if (!e164 || !/^\+[1-9]\d{7,14}$/.test(e164) || !tenantId) {
  console.error("Usage: number:add <+44... number> <tenantId> [label]");
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
  const row = await registerPhoneNumber({ db, sip }, owner.id, { e164, tenantId, label });
  console.log(
    `Registered ${row.e164} → business ${row.tenantId}\n  LiveKit trunk: ${row.livekitTrunkId}\n  Dispatch rule: ${row.livekitDispatchRuleId}`,
  );
} catch (error) {
  const cause = (error as { cause?: unknown }).cause;
  console.error("Failed:", error instanceof Error ? error.message : error, cause ?? "");
  process.exitCode = 1;
} finally {
  await closeDb(db);
}
