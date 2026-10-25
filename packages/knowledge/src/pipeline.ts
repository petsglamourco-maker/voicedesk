import type { EmbeddingProvider, ObjectStorage } from "@voicedesk/adapters";
import {
  knowledgeChunks,
  knowledgeDocuments,
  knowledgeSources,
  withTenant,
  type Database,
  type KnowledgeSourceStats,
} from "@voicedesk/db";
import { and, cosineDistance, eq, notInArray, sql } from "drizzle-orm";
import { chunkText } from "./chunker";
import { crawlSite } from "./crawler";
import { extractFile, fileTypeFor } from "./extract";
import type { SafeFetch } from "./safe-fetch";
import { cleanText, contentHash, detectLanguage } from "./text";

export interface KnowledgeDeps {
  db: Database;
  embeddings: EmbeddingProvider;
  storage?: ObjectStorage;
  fetch?: SafeFetch;
  log?: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };
}

export interface DocumentInput {
  url: string;
  title: string | null;
  text: string;
}

/**
 * Stores one document and (re)builds its chunks. Unchanged content (same hash) is skipped,
 * so recrawls are cheap. Returns the number of chunks written.
 */
export async function ingestDocument(
  deps: KnowledgeDeps,
  tenantId: string,
  sourceId: string,
  input: DocumentInput,
): Promise<{ chunks: number; unchanged: boolean }> {
  const text = cleanText(input.text);
  const hash = contentHash(text);

  const existing = await withTenant(deps.db, tenantId, (tx) =>
    tx
      .select({ id: knowledgeDocuments.id, hash: knowledgeDocuments.contentHash })
      .from(knowledgeDocuments)
      .where(and(eq(knowledgeDocuments.sourceId, sourceId), eq(knowledgeDocuments.url, input.url))),
  );
  // nosemgrep: ajinabraham.njsscan.crypto.timing_attack_node.node_timing_attack -- reviewed: not a secret comparison (empty-string check / content hash)
  if (existing[0]?.hash === hash) return { chunks: 0, unchanged: true };

  const chunks = chunkText(text);
  // Embed outside the transaction (CPU-bound, can take seconds).
  const vectors = await deps.embeddings.embed(
    chunks.map((c) => c.content),
    "passage",
  );

  await withTenant(deps.db, tenantId, async (tx) => {
    const [doc] = await tx
      .insert(knowledgeDocuments)
      .values({
        tenantId,
        sourceId,
        url: input.url,
        title: input.title,
        contentHash: hash,
        text,
        language: detectLanguage(text),
      })
      .onConflictDoUpdate({
        target: [knowledgeDocuments.sourceId, knowledgeDocuments.url],
        set: {
          title: input.title,
          contentHash: hash,
          text,
          language: detectLanguage(text),
          fetchedAt: new Date(),
        },
      })
      .returning({ id: knowledgeDocuments.id });
    await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, doc!.id));
    if (chunks.length > 0) {
      await tx.insert(knowledgeChunks).values(
        chunks.map((c, i) => ({
          tenantId,
          sourceId,
          documentId: doc!.id,
          ordinal: c.ordinal,
          heading: c.heading,
          content: c.content,
          tokenCount: c.tokenCount,
          embedding: vectors[i]!,
          embeddingModel: deps.embeddings.model,
        })),
      );
    }
  });
  return { chunks: chunks.length, unchanged: false };
}

async function setSourceStatus(
  deps: KnowledgeDeps,
  tenantId: string,
  sourceId: string,
  patch: Partial<typeof knowledgeSources.$inferInsert>,
) {
  await withTenant(deps.db, tenantId, (tx) =>
    tx.update(knowledgeSources).set(patch).where(eq(knowledgeSources.id, sourceId)),
  );
}

async function countStats(deps: KnowledgeDeps, tenantId: string, sourceId: string) {
  return withTenant(deps.db, tenantId, async (tx) => {
    const [docs] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.sourceId, sourceId));
    const [chunks] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.sourceId, sourceId));
    return { documents: docs?.n ?? 0, chunks: chunks?.n ?? 0 };
  });
}

/**
 * Processes a knowledge source end to end (crawl / extract → chunk → embed → store) and
 * records status and stats on the source row. Never throws for content problems; the
 * error is stored on the source instead.
 */
export async function processSource(
  deps: KnowledgeDeps,
  tenantId: string,
  sourceId: string,
): Promise<KnowledgeSourceStats> {
  const [source] = await withTenant(deps.db, tenantId, (tx) =>
    tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, sourceId)),
  );
  if (!source) throw new Error(`knowledge source ${sourceId} not found`);
  await setSourceStatus(deps, tenantId, sourceId, { status: "processing", error: null });

  try {
    let skipped = 0;
    if (source.type === "website") {
      if (!deps.fetch) throw new Error("website sources need a fetcher");
      const seenUrls: string[] = [];
      const result = await crawlSite(source.url!, {
        pageLimit: source.settings.pageLimit ?? 50,
        fetch: deps.fetch,
        onPage: async (page) => {
          seenUrls.push(page.url);
          await ingestDocument(deps, tenantId, sourceId, page);
        },
        onSkip: (url, reason) => deps.log?.warn({ sourceId, url, reason }, "page skipped"),
      });
      skipped = result.skipped;
      if (result.pages === 0) {
        throw new Error(
          "No readable pages found. Check the address, or whether the site blocks crawlers.",
        );
      }
      // Pages that disappeared from the site are removed from the knowledge base.
      await withTenant(deps.db, tenantId, (tx) =>
        tx
          .delete(knowledgeDocuments)
          .where(
            and(
              eq(knowledgeDocuments.sourceId, sourceId),
              notInArray(knowledgeDocuments.url, seenUrls),
            ),
          ),
      );
    } else if (source.type === "file") {
      if (!deps.storage || !source.fileKey) throw new Error("file source has no stored file");
      const type = fileTypeFor(source.fileName ?? "", source.mimeType ?? undefined);
      if (!type) throw new Error("Unsupported file type. Use PDF, DOCX, CSV or TXT.");
      const data = await deps.storage.get(source.fileKey);
      if (!data) throw new Error("Uploaded file is missing from storage");
      const text = await extractFile(data, type);
      if (text.length < 20)
        throw new Error("No readable text found in the file (is it a scanned image?)");
      await ingestDocument(deps, tenantId, sourceId, {
        url: `file:${source.fileName}`,
        title: source.fileName,
        text,
      });
    } else {
      await ingestDocument(deps, tenantId, sourceId, {
        url: `text:${sourceId}`,
        title: source.title,
        text: source.textContent ?? "",
      });
    }

    const stats = { ...(await countStats(deps, tenantId, sourceId)), skipped };
    await setSourceStatus(deps, tenantId, sourceId, {
      status: "ready",
      stats,
      lastRunAt: new Date(),
    });
    deps.log?.info({ sourceId, ...stats }, "knowledge source processed");
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed";
    await setSourceStatus(deps, tenantId, sourceId, {
      status: "failed",
      error: message.slice(0, 500),
      lastRunAt: new Date(),
    });
    deps.log?.warn({ sourceId, error: message }, "knowledge source failed");
    return {};
  }
}

export interface KnowledgeHit {
  content: string;
  heading: string | null;
  url: string;
  title: string | null;
  score: number;
}

/** Semantic search over one tenant's knowledge (RLS-scoped). */
export async function searchKnowledge(
  deps: Pick<KnowledgeDeps, "db" | "embeddings">,
  tenantId: string,
  query: string,
  options: { limit?: number; minScore?: number } = {},
): Promise<KnowledgeHit[]> {
  const [vector] = await deps.embeddings.embed([query], "query");
  const distance = cosineDistance(knowledgeChunks.embedding, vector!);
  const rows = await withTenant(deps.db, tenantId, (tx) =>
    tx
      .select({
        content: knowledgeChunks.content,
        heading: knowledgeChunks.heading,
        url: knowledgeDocuments.url,
        title: knowledgeDocuments.title,
        distance,
      })
      .from(knowledgeChunks)
      .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgeChunks.documentId))
      .orderBy(distance)
      .limit(options.limit ?? 5),
  );
  return rows
    .map((r) => ({ ...r, score: 1 - Number(r.distance) }))
    .filter((r) => r.score >= (options.minScore ?? 0))
    .map(({ distance: _d, ...hit }) => hit);
}
