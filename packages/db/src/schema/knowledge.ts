import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { tenants, timestamps } from "./app";

/** Embedding dimension of the configured model (multilingual-e5-small). See ADR 0010. */
export const EMBEDDING_DIMENSIONS = 384;

export const knowledgeSourceType = pgEnum("knowledge_source_type", ["website", "file", "text"]);
export const knowledgeSourceStatus = pgEnum("knowledge_source_status", [
  "pending",
  "processing",
  "ready",
  "failed",
]);

export interface KnowledgeSourceSettings {
  pageLimit?: number;
  recrawlDays?: number | null;
}

export interface KnowledgeSourceStats {
  documents?: number;
  chunks?: number;
  skipped?: number;
}

/** Where knowledge comes from: a website to crawl, an uploaded file, or pasted text. */
export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    type: knowledgeSourceType("type").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    fileKey: text("file_key"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    textContent: text("text_content"),
    settings: jsonb("settings").$type<KnowledgeSourceSettings>().notNull().default({}),
    status: knowledgeSourceStatus("status").notNull().default("pending"),
    stats: jsonb("stats").$type<KnowledgeSourceStats>().notNull().default({}),
    error: text("error"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    ...timestamps,
  },
  (t) => [index("knowledge_sources_tenant_idx").on(t.tenantId)],
);

/** One fetched page or extracted file. Re-ingesting replaces its chunks. */
export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    url: text("url").notNull(), // page URL, or "file:<name>" / "text:<id>"
    title: text("title"),
    contentHash: text("content_hash").notNull(),
    text: text("text").notNull(),
    language: text("language"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("knowledge_documents_source_url_uq").on(t.sourceId, t.url),
    index("knowledge_documents_tenant_idx").on(t.tenantId),
  ],
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    heading: text("heading"),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    embeddingModel: text("embedding_model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("knowledge_chunks_tenant_idx").on(t.tenantId),
    index("knowledge_chunks_document_idx").on(t.documentId),
    index("knowledge_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const profileStatus = pgEnum("business_profile_status", ["draft", "approved", "superseded"]);

/**
 * Versioned business profile. `data` is validated by BusinessProfileData in
 * @voicedesk/agent-brain. Only one version per tenant is `approved` at a time.
 */
export const businessProfiles = pgTable(
  "business_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: profileStatus("status").notNull().default("draft"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    generatedBy: text("generated_by").notNull(), // "ai" | "manual"
    createdBy: uuid("created_by"),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("business_profiles_tenant_version_uq").on(t.tenantId, t.version)],
);
