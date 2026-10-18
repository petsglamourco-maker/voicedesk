import { randomUUID } from "node:crypto";
import { cosineDistance, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "../src/client";
import {
  aiProviders,
  auditLog,
  contacts,
  EMBEDDING_DIMENSIONS,
  knowledgeChunks,
  knowledgeDocuments,
  knowledgeSources,
  phoneNumbers,
  publicEndpoints,
  tenants,
  tickets,
} from "../src/schema";
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

describe("phase 1 tables", () => {
  it("keeps tickets and knowledge chunks inside their tenant", async () => {
    const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i % 7) / 7);
    await withTenant(dbs.app, tenantB, async (tx) => {
      await tx.insert(tickets).values({
        tenantId: tenantB,
        reference: `T-${randomUUID().slice(0, 6)}`,
        details: { issue: "secret" },
      });
      const [source] = await tx
        .insert(knowledgeSources)
        .values({ tenantId: tenantB, type: "text", title: "B notes", textContent: "secret" })
        .returning();
      const [doc] = await tx
        .insert(knowledgeDocuments)
        .values({
          tenantId: tenantB,
          sourceId: source!.id,
          url: "text:b",
          contentHash: "h",
          text: "secret",
        })
        .returning();
      await tx.insert(knowledgeChunks).values({
        tenantId: tenantB,
        sourceId: source!.id,
        documentId: doc!.id,
        ordinal: 0,
        content: "B's private pricing",
        tokenCount: 4,
        embedding,
        embeddingModel: "test",
      });
    });

    const seenByA = await withTenant(dbs.app, tenantA, async (tx) => ({
      tickets: await tx.select().from(tickets),
      chunks: await tx
        .select({ id: knowledgeChunks.id })
        .from(knowledgeChunks)
        .orderBy(cosineDistance(knowledgeChunks.embedding, embedding))
        .limit(5),
    }));
    expect(seenByA.tickets).toHaveLength(0);
    expect(seenByA.chunks).toHaveLength(0);

    const seenByB = await withTenant(dbs.app, tenantB, (tx) =>
      tx.select({ id: knowledgeChunks.id }).from(knowledgeChunks),
    );
    expect(seenByB.length).toBeGreaterThan(0);
  });
});

describe("platform AI provider settings", () => {
  it("are readable but only writable under platform access", async () => {
    const rows = await dbs.app.select().from(aiProviders);
    expect(rows.map((r) => r.key).sort()).toEqual(["anthropic", "deepseek", "local"]);

    const updated = await dbs.app
      .update(aiProviders)
      .set({ enabled: true })
      .where(eq(aiProviders.key, "local"))
      .returning();
    expect(updated).toHaveLength(0); // RLS hides the row from writes

    const viaPlatform = await withPlatformAccess(
      dbs.app,
      { actorUserId: randomUUID(), reason: "test" },
      (tx) =>
        tx
          .update(aiProviders)
          .set({ notes: "checked" })
          .where(eq(aiProviders.key, "local"))
          .returning(),
    );
    expect(viaPlatform).toHaveLength(1);
  });
});

describe("phone numbers", () => {
  it("are readable by their business but only written under platform access", async () => {
    const e164 = `+4420${Math.floor(1e7 + Math.random() * 9e7)}`;
    await expectPgError(
      withTenant(dbs.app, tenantA, (tx) =>
        tx.insert(phoneNumbers).values({ tenantId: tenantA, e164 }),
      ),
      /row-level security/,
    );
    const [row] = await withPlatformAccess(
      dbs.app,
      { actorUserId: randomUUID(), reason: "test" },
      (tx) => tx.insert(phoneNumbers).values({ tenantId: tenantA, e164 }).returning(),
    );
    const own = await withTenant(dbs.app, tenantA, (tx) =>
      tx.select().from(phoneNumbers).where(eq(phoneNumbers.id, row!.id)),
    );
    expect(own).toHaveLength(1);
    const other = await withTenant(dbs.app, tenantB, (tx) =>
      tx.select().from(phoneNumbers).where(eq(phoneNumbers.id, row!.id)),
    );
    expect(other).toHaveLength(0);
    const changed = await withTenant(dbs.app, tenantA, (tx) =>
      tx
        .update(phoneNumbers)
        .set({ label: "hijack" })
        .where(eq(phoneNumbers.id, row!.id))
        .returning(),
    );
    expect(changed).toHaveLength(0);
  });
});

describe("public endpoint resolver", () => {
  it("returns only the matching endpoint and doesn't leave platform access on", async () => {
    const key = `pk_${randomUUID().replace(/-/g, "")}`;
    await withTenant(dbs.app, tenantB, (tx) =>
      tx
        .insert(publicEndpoints)
        .values({ tenantId: tenantB, kind: "widget", key, config: { a: 1 } }),
    );
    const result = await dbs.app.transaction(async (tx) => {
      const rows = await tx.execute(
        sql`select * from app_resolve_public_endpoint(${"widget"}, ${key})`,
      );
      const after = await tx.execute(sql`select app_platform_access() as on`);
      const leak = await tx.select().from(contacts);
      return { rows, after, leak };
    });
    const rows = result.rows.rows as Array<{ tenant_id: string; enabled: boolean }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenant_id).toBe(tenantB);
    expect((result.after.rows as Array<{ on: boolean }>)[0]?.on).toBe(false);
    expect(result.leak).toHaveLength(0);
    const none = await dbs.app.execute(
      sql`select * from app_resolve_public_endpoint(${"form"}, ${key})`,
    );
    expect(none.rows).toHaveLength(0);
  });
});
