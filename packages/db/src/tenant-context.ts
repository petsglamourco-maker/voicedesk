import { sql } from "drizzle-orm";
import { type Database, type Tx, platformDbFor } from "./client";
import { auditLog } from "./schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Runs `fn` in a transaction scoped to one tenant. Row-Level Security policies read
 * `app.tenant_id`, which is set transaction-locally so it can never leak to another
 * request sharing the pooled connection.
 *
 * Callers must have already verified the acting user belongs to `tenantId`.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!isUuid(tenantId)) throw new Error("withTenant: tenantId must be a UUID");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

export interface PlatformAccess {
  /** User performing the cross-tenant action; must be a verified platform owner. */
  actorUserId: string;
  /** Why cross-tenant access is needed (recorded in the audit log). */
  reason: string;
}

/**
 * Runs `fn` with cross-tenant visibility, for platform-owner tooling and system jobs.
 * Every use is written to the audit log. Never call this from tenant-facing code paths.
 */
export async function withPlatformAccess<T>(
  db: Database,
  access: PlatformAccess,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  // Only the separate platform login may switch this on (security audit M11).
  return platformDbFor(db).transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.platform_access', 'on', true)`);
    await tx.insert(auditLog).values({
      actorType: "platform_owner",
      actorUserId: access.actorUserId,
      action: "platform.access",
      metadata: { reason: access.reason },
    });
    return fn(tx);
  });
}
