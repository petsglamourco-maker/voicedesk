// Applies migrations as the owner role. `--test` targets the test database.
import { fileURLToPath } from "node:url";
import { loadRootEnv, requireEnv } from "@voicedesk/config/load-env";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, createDb } from "./client";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

export async function runMigrations(ownerUrl: string): Promise<void> {
  const db = createDb(ownerUrl, { maxConnections: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await closeDb(db);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadRootEnv();
  const isTest = process.argv.includes("--test");
  const url = requireEnv(isTest ? "TEST_DATABASE_OWNER_URL" : "DATABASE_OWNER_URL");
  await runMigrations(url);
  console.log(`Migrations applied (${isTest ? "test" : "dev"} database).`);
}
