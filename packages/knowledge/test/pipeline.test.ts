import { InMemoryObjectStorage, MockEmbeddingProvider, tenantKey } from "@voicedesk/adapters";
import { closeDb, knowledgeSources, withTenant } from "@voicedesk/db";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processSource, searchKnowledge, type KnowledgeDeps } from "../src/pipeline";

let dbs: TestDbs;
let deps: KnowledgeDeps;
let tenantA: string;
let tenantB: string;
const storage = new InMemoryObjectStorage();

async function addSource(tenantId: string, values: Partial<typeof knowledgeSources.$inferInsert>) {
  const [row] = await withTenant(dbs.app, tenantId, (tx) =>
    tx
      .insert(knowledgeSources)
      .values({ tenantId, type: "text", title: "Notes", ...values })
      .returning(),
  );
  return row!;
}

beforeAll(async () => {
  dbs = connectTestDbs();
  deps = { db: dbs.app, embeddings: new MockEmbeddingProvider(), storage };
  tenantA = await createTestTenant(dbs.owner, "Knowledge A");
  tenantB = await createTestTenant(dbs.owner, "Knowledge B");
});

afterAll(async () => {
  await closeDb(dbs.app);
  await closeDb(dbs.owner);
});

describe("knowledge pipeline", () => {
  it("ingests pasted text and finds it by search", async () => {
    const source = await addSource(tenantA, {
      textContent:
        "# Parking\n\nFree parking is available behind the clinic on Elm Street.\n\n# Payment\n\nWe accept card and cash payments.",
    });
    const stats = await processSource(deps, tenantA, source.id);
    expect(stats.chunks).toBeGreaterThan(0);

    const [row] = await withTenant(dbs.app, tenantA, (tx) =>
      tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, source.id)),
    );
    expect(row?.status).toBe("ready");

    const hits = await searchKnowledge(deps, tenantA, "Is there parking at the clinic?");
    expect(hits[0]?.content).toContain("Free parking");
  });

  it("skips unchanged content on re-processing", async () => {
    const source = await addSource(tenantA, { textContent: "We are closed on bank holidays." });
    await processSource(deps, tenantA, source.id);
    const again = await processSource(deps, tenantA, source.id);
    expect(again.documents).toBe(1);
  });

  it("extracts uploaded files from storage", async () => {
    const key = tenantKey(tenantA, "uploads", "prices.csv");
    await storage.put({ key, body: "Service,Price\nWhitening,£250\n" });
    const source = await addSource(tenantA, {
      type: "file",
      title: "prices.csv",
      fileKey: key,
      fileName: "prices.csv",
      mimeType: "text/csv",
    });
    await processSource(deps, tenantA, source.id);
    const hits = await searchKnowledge(deps, tenantA, "whitening price");
    expect(hits.some((h) => h.content.includes("£250"))).toBe(true);
  });

  it("records failures on the source instead of throwing", async () => {
    const source = await addSource(tenantA, {
      type: "file",
      title: "photo.jpg",
      fileKey: "missing",
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
    });
    await processSource(deps, tenantA, source.id);
    const [row] = await withTenant(dbs.app, tenantA, (tx) =>
      tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, source.id)),
    );
    expect(row).toMatchObject({ status: "failed" });
    expect(row?.error).toMatch(/Unsupported file type/);
  });

  it("never returns another tenant's knowledge", async () => {
    const source = await addSource(tenantB, {
      textContent: "Tenant B secret discount code ZEBRA.",
    });
    await processSource(deps, tenantB, source.id);
    const hits = await searchKnowledge(deps, tenantA, "secret discount code ZEBRA", { limit: 50 });
    expect(hits.some((h) => h.content.includes("ZEBRA"))).toBe(false);
  });
});
