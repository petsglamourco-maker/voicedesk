import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "../src/client";
import { auditLog, contacts, tenants } from "../src/schema";
import { withPlatformAccess, withTenant } from "../src/tenant-context";
import { connectTestDbs, createTestTenant, type TestDbs } from "../src/testing";

/** Drizzle wraps driver errors ("Failed query: ..."); assert on the Postgres error itself. */
async function expectPgError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, "expected the query to fail").toBeInstanceOf(Error);
  const cause = (error as Error).cause;
  const message = cause instanceof Error ? cause.message : (error as Error).message;
  expect(message).toMatch(pattern);
}

let dbs: TestDbs;
let tenantA: string;
let tenantB: string;
let contactB: string;

beforeAll(async () => {
  dbs = connectTestDbs();
  tenantA = await createTestTenant(dbs.owner, "Tenant A");
  tenantB = await createTestTenant(dbs.owner, "Tenant B");

  await withTenant(dbs.app, tenantA, (tx) =>
    tx.insert(contacts).values({ tenantId: tenantA, fullName: "Alice (A)" }),
  );
  const [row] = await withTenant(dbs.app, tenantB, (tx) =>
    tx
      .insert(contacts)
      .values({ tenantId: tenantB, fullName: "Bob (B)" })
      .returning({ id: contacts.id }),
  );
  contactB = row!.id;
});

afterAll(async () => {
  await closeDb(dbs.app);
  await closeDb(dbs.owner);
});

describe("tenant isolation (Row-Level Security)", () => {
  it("only returns the current tenant's rows", async () => {
    const rows = await withTenant(dbs.app, tenantA, (tx) => tx.select().from(contacts));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenantId === tenantA)).toBe(true);

    const visibleTenants = await withTenant(dbs.app, tenantA, (tx) => tx.select().from(tenants));
    expect(visibleTenants.map((t) => t.id)).toEqual([tenantA]);
  });

  it("cannot read another tenant's row even by id", async () => {
    const rows = await withTenant(dbs.app, tenantA, (tx) =>
      tx.select().from(contacts).where(eq(contacts.id, contactB)),
    );
    expect(rows).toHaveLength(0);
  });

  it("cannot update or delete another tenant's rows", async () => {
    const updated = await withTenant(dbs.app, tenantA, (tx) =>
      tx
        .update(contacts)
        .set({ fullName: "hijacked" })
        .where(eq(contacts.id, contactB))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    const deleted = await withTenant(dbs.app, tenantA, (tx) =>
      tx.delete(contacts).where(eq(contacts.id, contactB)).returning(),
    );
    expect(deleted).toHaveLength(0);

    const [stillThere] = await withTenant(dbs.app, tenantB, (tx) =>
      tx.select().from(contacts).where(eq(contacts.id, contactB)),
    );
    expect(stillThere?.fullName).toBe("Bob (B)");
  });

  it("rejects inserting a row for another tenant", async () => {
    await expectPgError(
      withTenant(dbs.app, tenantA, (tx) =>
        tx.insert(contacts).values({ tenantId: tenantB, fullName: "smuggled" }),
      ),
      /row-level security/i,
    );
  });

  it("rejects moving a row to another tenant", async () => {
    await expectPgError(
      withTenant(dbs.app, tenantA, (tx) =>
        tx.update(contacts).set({ tenantId: tenantB }).where(eq(contacts.tenantId, tenantA)),
      ),
      /row-level security/i,
    );
  });

  it("returns nothing when no tenant context is set (fails closed)", async () => {
    expect(await dbs.app.select().from(contacts)).toHaveLength(0);
    expect(await dbs.app.select().from(tenants)).toHaveLength(0);
    expect(await dbs.app.select().from(auditLog)).toHaveLength(0);
  });

  it("does not leak tenant context to the next query on a pooled connection", async () => {
    const single = createDb(process.env.TEST_DATABASE_URL!, { maxConnections: 1 });
    try {
      await withTenant(single, tenantA, (tx) => tx.select().from(contacts));
      expect(await single.select().from(contacts)).toHaveLength(0);
    } finally {
      await closeDb(single);
    }
  });

  it("applies to the table owner too (FORCE RLS)", async () => {
    expect(await dbs.owner.select().from(contacts)).toHaveLength(0);
  });

  it("rejects a non-UUID tenant id", async () => {
    await expect(withTenant(dbs.app, "' or 1=1 --", () => Promise.resolve())).rejects.toThrow(
      /UUID/,
    );
  });
});

describe("database roles", () => {
  it("runtime role cannot bypass RLS", async () => {
    const result = await dbs.app.execute<{ rolbypassrls: boolean; rolsuper: boolean }>(
      sql`select rolbypassrls, rolsuper from pg_roles where rolname = current_user`,
    );
    expect(result.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it("runtime role cannot disable RLS", async () => {
    await expectPgError(
      dbs.app.execute(sql`alter table contacts disable row level security`),
      /must be owner/i,
    );
  });

  it("every table with a tenant_id column has forced RLS", async () => {
    const result = await dbs.owner.execute<{ relname: string }>(sql`
      select c.relname
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      where c.relnamespace = 'public'::regnamespace
        and c.relkind = 'r'
        and not (c.relrowsecurity and c.relforcerowsecurity)
    `);
    expect(result.rows.map((r) => r.relname)).toEqual([]);
  });
});

describe("platform access", () => {
  it("can see all tenants and records an audit entry", async () => {
    const actor = randomUUID();
    const ids = await withPlatformAccess(dbs.app, { actorUserId: actor, reason: "test" }, (tx) =>
      tx.select({ id: tenants.id }).from(tenants),
    );
    expect(ids.map((r) => r.id)).toEqual(expect.arrayContaining([tenantA, tenantB]));

    const entries = await withPlatformAccess(
      dbs.app,
      { actorUserId: randomUUID(), reason: "verify" },
      (tx) => tx.select().from(auditLog).where(eq(auditLog.actorUserId, actor)),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe("platform.access");
  });
});

describe("audit log", () => {
  it("is append-only for the runtime role", async () => {
    await withTenant(dbs.app, tenantA, (tx) =>
      tx.insert(auditLog).values({ tenantId: tenantA, actorType: "system", action: "test.event" }),
    );
    await expectPgError(
      withTenant(dbs.app, tenantA, (tx) =>
        tx.update(auditLog).set({ action: "tampered" }).where(eq(auditLog.tenantId, tenantA)),
      ),
      /permission denied/i,
    );
    await expectPgError(
      withTenant(dbs.app, tenantA, (tx) =>
        tx.delete(auditLog).where(eq(auditLog.tenantId, tenantA)),
      ),
      /permission denied/i,
    );
  });

  it("is append-only even for the owner role", async () => {
    await expectPgError(
      withPlatformAccess(dbs.owner, { actorUserId: randomUUID(), reason: "test" }, (tx) =>
        tx.update(auditLog).set({ action: "tampered" }).where(eq(auditLog.tenantId, tenantA)),
      ),
      /append-only/,
    );
  });

  it("is only readable by the owning tenant", async () => {
    const rows = await withTenant(dbs.app, tenantB, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.tenantId, tenantA)),
    );
    expect(rows).toHaveLength(0);
  });
});
