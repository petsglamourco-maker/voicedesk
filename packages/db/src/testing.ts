// Test helpers shared by packages that need a real database. Not for production code.
import { randomUUID } from "node:crypto";
import { loadRootEnv, requireEnv } from "@voicedesk/config/load-env";
import { createDb, type Database } from "./client";
import { organization, tenants } from "./schema";
import { withPlatformAccess } from "./tenant-context";

export interface TestDbs {
  /** Connected as the RLS-bound runtime role. */
  app: Database;
  /** Connected as the owner role (still subject to FORCE RLS). */
  owner: Database;
}

export function connectTestDbs(): TestDbs {
  loadRootEnv();
  return {
    app: createDb(requireEnv("TEST_DATABASE_URL"), { maxConnections: 4 }),
    owner: createDb(requireEnv("TEST_DATABASE_OWNER_URL"), { maxConnections: 2 }),
  };
}

/** Creates an organization + tenant row with unique values. Returns the tenant id. */
export async function createTestTenant(db: Database, name = "Test Business"): Promise<string> {
  const id = randomUUID();
  await db.insert(organization).values({
    id,
    name,
    slug: `test-${id}`,
    createdAt: new Date(),
  });
  await withPlatformAccess(db, { actorUserId: randomUUID(), reason: "test setup" }, (tx) =>
    tx.insert(tenants).values({
      id,
      name,
      countryCode: "GB",
      timezone: "Europe/London",
    }),
  );
  return id;
}
