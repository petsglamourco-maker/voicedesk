import { randomUUID } from "node:crypto";
import { tenantKey } from "@voicedesk/adapters";
import { recordAudit } from "@voicedesk/core";
import { knowledgeSources, withTenant } from "@voicedesk/db";
import {
  CONTENT_TYPES,
  contentMatches,
  fileTypeFor,
  isPublicAddress,
  searchKnowledge,
} from "@voicedesk/knowledge";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { isIP } from "node:net";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { requireTenantAccess } from "./guards";

const sourceSchema = z.object({
  id: z.string(),
  type: z.enum(["website", "file", "text"]),
  title: z.string(),
  url: z.string().nullable(),
  fileName: z.string().nullable(),
  settings: z.object({
    pageLimit: z.number().optional(),
    recrawlDays: z.number().nullable().optional(),
  }),
  status: z.enum(["pending", "processing", "ready", "failed"]),
  stats: z.object({
    documents: z.number().optional(),
    chunks: z.number().optional(),
    skipped: z.number().optional(),
  }),
  error: z.string().nullable(),
  lastRunAt: z.date().nullable(),
  createdAt: z.date(),
});

const params = z.object({ tenantId: z.string() });
const sourceParams = params.extend({ sourceId: z.string().uuid() });

const createSourceBody = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("website"),
    url: z.string().trim().min(4).max(2000),
    pageLimit: z.number().int().min(1).max(200).default(50),
    recrawlDays: z.number().int().min(1).max(90).nullable().default(7),
  }),
  z.object({
    type: z.literal("text"),
    title: z.string().trim().min(1).max(200),
    text: z.string().trim().min(10).max(200_000),
  }),
]);

/** Accepts "example.com" or a full URL; rejects non-http(s) and literal private IPs. */
export function normaliseWebsiteUrl(input: string): string {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new HttpError(400, "INVALID_URL", "Enter a valid website address");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !host.includes(".") ||
    (isIP(host) && !isPublicAddress(host))
  ) {
    throw new HttpError(400, "INVALID_URL", "Enter a public website address");
  }
  url.hash = "";
  return url.toString();
}

export function registerKnowledgeRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["knowledge"];

  r.get(
    "/api/tenants/:tenantId/knowledge/sources",
    {
      schema: { tags, params, response: { 200: z.array(sourceSchema) } },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "knowledge:read",
      );
      return withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .select()
          .from(knowledgeSources)
          .where(eq(knowledgeSources.tenantId, access.tenantId))
          .orderBy(desc(knowledgeSources.createdAt)),
      );
    },
  );

  r.post(
    "/api/tenants/:tenantId/knowledge/sources",
    {
      schema: {
        tags,
        summary: "Add a website to crawl or a block of text (FAQ, policies…)",
        params,
        body: createSourceBody,
        response: { 201: sourceSchema },
      },
    },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "knowledge:write",
      );
      const body = request.body;
      const values =
        body.type === "website"
          ? (() => {
              const url = normaliseWebsiteUrl(body.url);
              return {
                type: "website" as const,
                title: new URL(url).hostname,
                url,
                settings: { pageLimit: body.pageLimit, recrawlDays: body.recrawlDays },
              };
            })()
          : { type: "text" as const, title: body.title, textContent: body.text };

      const source = await withTenant(deps.db, access.tenantId, async (tx) => {
        const [row] = await tx
          .insert(knowledgeSources)
          .values({ tenantId: access.tenantId, createdBy: access.session.user.id, ...values })
          .returning();
        await recordAudit(tx, {
          tenantId: access.tenantId,
          actorType: "user",
          actorUserId: access.session.user.id,
          action: "knowledge.source_added",
          targetType: "knowledge_source",
          targetId: row!.id,
          metadata: { type: row!.type },
        });
        return row!;
      });
      const job = { tenantId: access.tenantId, sourceId: source.id };
      await deps.jobs.processSource(job);
      if (source.type === "website")
        await deps.jobs.scheduleRecrawl(job, source.settings.recrawlDays);
      return reply.status(201).send(source);
    },
  );

  r.post(
    "/api/tenants/:tenantId/knowledge/files",
    {
      schema: {
        tags,
        summary: "Upload a PDF, DOCX, CSV or TXT file (multipart field 'file', max 20 MB)",
        params,
        consumes: ["multipart/form-data"],
        response: { 201: sourceSchema },
      },
    },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "knowledge:write",
      );
      const file = await request.file();
      if (!file) throw new HttpError(400, "NO_FILE", "Attach a file");
      const fileName = file.filename.replace(/[^\w.\- ]+/g, "_").slice(0, 150) || "upload";
      const type = fileTypeFor(fileName, file.mimetype);
      if (!type) {
        throw new HttpError(400, "UNSUPPORTED_FILE", "Upload a PDF, DOCX, CSV or TXT file");
      }
      const data = await file.toBuffer(); // throws 413 above the multipart size limit
      // The bytes must match the type; the name and the browser's MIME type aren't trusted
      // (security audit M5).
      if (!contentMatches(data, type)) {
        throw new HttpError(
          400,
          "FILE_CONTENT_MISMATCH",
          `This file isn't a valid ${type.toUpperCase()} file`,
        );
      }
      const key = tenantKey(
        access.tenantId,
        "knowledge",
        `${randomUUID()}-${fileName.replace(/ /g, "_")}`,
      );
      await deps.storage.put({ key, body: data, contentType: CONTENT_TYPES[type] });

      const source = await withTenant(deps.db, access.tenantId, async (tx) => {
        const [row] = await tx
          .insert(knowledgeSources)
          .values({
            tenantId: access.tenantId,
            type: "file",
            title: fileName,
            fileKey: key,
            fileName,
            mimeType: CONTENT_TYPES[type],
            createdBy: access.session.user.id,
          })
          .returning();
        await recordAudit(tx, {
          tenantId: access.tenantId,
          actorType: "user",
          actorUserId: access.session.user.id,
          action: "knowledge.source_added",
          targetType: "knowledge_source",
          targetId: row!.id,
          metadata: { type: "file", bytes: data.byteLength },
        });
        return row!;
      });
      await deps.jobs.processSource({ tenantId: access.tenantId, sourceId: source.id });
      return reply.status(201).send(source);
    },
  );

  r.post(
    "/api/tenants/:tenantId/knowledge/sources/:sourceId/refresh",
    { schema: { tags, summary: "Re-crawl or re-process a source", params: sourceParams } },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "knowledge:write",
      );
      const updated = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .update(knowledgeSources)
          .set({ status: "pending", error: null })
          .where(
            and(
              eq(knowledgeSources.id, request.params.sourceId),
              eq(knowledgeSources.tenantId, access.tenantId),
            ),
          )
          .returning({ id: knowledgeSources.id }),
      );
      if (updated.length === 0) throw notFound();
      await deps.jobs.processSource({
        tenantId: access.tenantId,
        sourceId: request.params.sourceId,
      });
      return reply.status(202).send({ status: "queued" });
    },
  );

  r.delete(
    "/api/tenants/:tenantId/knowledge/sources/:sourceId",
    {
      schema: {
        tags,
        summary: "Delete a source and everything learned from it",
        params: sourceParams,
      },
    },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "knowledge:write",
      );
      const [deleted] = await withTenant(deps.db, access.tenantId, async (tx) => {
        const rows = await tx
          .delete(knowledgeSources)
          .where(
            and(
              eq(knowledgeSources.id, request.params.sourceId),
              eq(knowledgeSources.tenantId, access.tenantId),
            ),
          )
          .returning();
        if (rows[0]) {
          await recordAudit(tx, {
            tenantId: access.tenantId,
            actorType: "user",
            actorUserId: access.session.user.id,
            action: "knowledge.source_deleted",
            targetType: "knowledge_source",
            targetId: rows[0].id,
          });
        }
        return rows;
      });
      if (!deleted) throw notFound();
      await deps.jobs.scheduleRecrawl({ tenantId: access.tenantId, sourceId: deleted.id }, null);
      if (deleted.fileKey) await deps.storage.delete(deleted.fileKey);
      return reply.status(204).send();
    },
  );

  r.get(
    "/api/tenants/:tenantId/knowledge/search",
    {
      schema: {
        tags,
        summary: "Test retrieval: what the agent would find for a question",
        params,
        querystring: z.object({ q: z.string().trim().min(2).max(500) }),
        response: {
          200: z.array(
            z.object({
              content: z.string(),
              heading: z.string().nullable(),
              url: z.string(),
              title: z.string().nullable(),
              score: z.number(),
            }),
          ),
        },
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "knowledge:read",
      );
      const embeddings = await deps.embeddings();
      return searchKnowledge({ db: deps.db, embeddings }, access.tenantId, request.query.q, {
        limit: 5,
      });
    },
  );
}
