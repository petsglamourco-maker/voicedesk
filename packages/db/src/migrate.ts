// Applies migrations as the owner role. `--test` targets the test database.
import { fileURLToPath } from "node:url";
import { loadRootEnv, requireEnv } from "@voicedesk/config/load-env";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, createDb } from "./client";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

/** Arbitrary constant: the advisory-lock key that serialises migration runs. */
const MIGRATION_LOCK = 724_201_026;

export async function runMigrations(ownerUrl: string): Promise<void> {
  // One connection, so the session lock below covers the whole migration.
  const db = createDb(ownerUrl, { maxConnections: 1, platformUrl: null });
  try {
    // Several test packages start at once (each migrates the test database first): on a
    // fresh database they'd race to create the same tables. The lock makes them take turns;
    // later ones find nothing left to do.
    await db.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK})`);
    try {
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await db.execute(sql`select pg_advisory_unlock(${MIGRATION_LOCK})`);
    }
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
