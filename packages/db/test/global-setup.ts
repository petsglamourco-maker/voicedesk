import { loadRootEnv, requireEnv } from "@voicedesk/config/load-env";
import { runMigrations } from "../src/migrate";

export default async function setup(): Promise<void> {
  loadRootEnv();
  await runMigrations(requireEnv("TEST_DATABASE_OWNER_URL"));
}
