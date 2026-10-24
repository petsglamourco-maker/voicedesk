// pnpm --filter @voicedesk/core reencrypt — after rotating SETTINGS_ENCRYPTION_KEY (put the
// old one in SETTINGS_ENCRYPTION_OLD_KEYS), moves every stored secret to the new key.
import { loadRootEnv, requireEnv } from "@voicedesk/config/load-env";
import { closeDb, createDb, user } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { reencryptAll } from "./reencrypt";
import { SecretBox } from "./secret-box";

loadRootEnv();
const box = SecretBox.fromEnv();
if (!box) throw new Error("SETTINGS_ENCRYPTION_KEY isn't set");
const db = createDb(requireEnv("DATABASE_URL"));
try {
  const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.isPlatformOwner, true));
  if (!owner) throw new Error("No platform owner to record this against: run pnpm db:seed first");
  const report = await reencryptAll(db, box, owner.id);
  console.log(
    `Key "${box.currentKeyId}": ${report.rotated} re-encrypted, ${report.current} already current, ${report.unreadable} unreadable.`,
  );
  if (report.unreadable > 0) {
    console.log(
      "Some values need a key that isn't configured: add it to SETTINGS_ENCRYPTION_OLD_KEYS.",
    );
    process.exitCode = 1;
  }
} finally {
  await closeDb(db);
}
