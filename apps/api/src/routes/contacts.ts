import { normalisePhone } from "@voicedesk/agent-brain";
import { CONTACT_FIELDS, guessMapping, parseCsv, recordAudit } from "@voicedesk/core";
import {
  bookings,
  contacts,
  conversations,
  staffMessages,
  tenants,
  tickets,
  withTenant,
} from "@voicedesk/db";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { MAX_IMPORT_ROWS, planImport } from "../lib/contact-import";
import { HttpError, notFound } from "../lib/errors";
import { requireTenantAccess } from "./guards";

const params = z.object({ tenantId: z.string() });
const contactParams = params.extend({ contactId: z.string().uuid() });
const mappingSchema = z.object(
  Object.fromEntries(CONTACT_FIELDS.map((f) => [f, z.number().int().min(0).optional()])) as Record<
    (typeof CONTACT_FIELDS)[number],
    z.ZodOptional<z.ZodNumber>
  >,
);
const csvBody = z.string().min(1).max(3_000_000);

type ContactRow = typeof contacts.$inferSelect;
const view = (c: ContactRow) => ({
  id: c.id,
  fullName: c.fullName,
  phone: c.phoneE164,
  email: c.email,
  notes: c.notes,
  source: c.source,
  interest: c.interest,
  marketingConsent: c.marketingConsent,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

function isUniqueViolation(error: unknown): boolean {
  const code = (e: unknown) => (e as { code?: string } | undefined)?.code;
  return code(error) === "23505" || code((error as { cause?: unknown })?.cause) === "23505";
}

export function registerContactRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["contacts"];

  async function country(tenantId: string): Promise<string> {
    const [t] = await withTenant(deps.db, tenantId, (tx) =>
      tx.select({ c: tenants.countryCode }).from(tenants).where(eq(tenants.id, tenantId)),
    );
    return t?.c ?? "GB";
  }

  const editable = z.object({
    fullName: z.string().trim().max(200).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    email: z.string().trim().email().max(200).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    marketingConsent: z.boolean().optional(),
  });

  async function toValues(tenantId: string, body: z.infer<typeof editable>) {
    const values: Partial<typeof contacts.$inferInsert> = {};
    if (body.fullName !== undefined) values.fullName = body.fullName || null;
    if (body.email !== undefined) values.email = body.email?.toLowerCase() || null;
    if (body.notes !== undefined) values.notes = body.notes || null;
    if (body.marketingConsent !== undefined) {
      values.marketingConsent = body.marketingConsent;
      values.consentAt = body.marketingConsent ? new Date() : null;
    }
    if (body.phone !== undefined) {
      if (!body.phone) values.phoneE164 = null;
      else {
        const e164 = normalisePhone(body.phone, await country(tenantId));
        if (!e164) throw new HttpError(400, "INVALID_PHONE", "That phone number isn't valid");
        values.phoneE164 = e164;
      }
    }
    return values;
  }

  r.get(
    "/api/tenants/:tenantId/contacts",
    {
      schema: {
        tags,
        summary: "Search contacts by name, phone or email",
        params,
        querystring: z.object({
          q: z.string().trim().max(100).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "contacts:read",
      );
      const { q, limit, offset } = request.query;
      const term = q ? `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
      const digits = q?.replace(/\D/g, "");
      const where = and(
        eq(contacts.tenantId, access.tenantId),
        term
          ? or(
              ilike(contacts.fullName, term),
              ilike(contacts.email, term),
              digits && digits.length >= 3
                ? ilike(contacts.phoneE164, `%${digits.slice(-9)}%`)
                : undefined,
            )
          : undefined,
      );
      return withTenant(deps.db, access.tenantId, async (tx) => {
        const rows = await tx
          .select()
          .from(contacts)
          .where(where)
          .orderBy(desc(contacts.updatedAt))
          .limit(limit)
          .offset(offset);
        const [count] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(contacts)
          .where(where);
        return { contacts: rows.map(view), total: count?.n ?? 0 };
      });
    },
  );

  r.get(
    "/api/tenants/:tenantId/contacts/:contactId",
    { schema: { tags, summary: "A contact and everything linked to them", params: contactParams } },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "contacts:read",
      );
      return withTenant(deps.db, access.tenantId, async (tx) => {
        const [contact] = await tx
          .select()
          .from(contacts)
          .where(
            and(eq(contacts.id, request.params.contactId), eq(contacts.tenantId, access.tenantId)),
          );
        if (!contact) throw notFound();
        const id = contact.id;
        const [calls, bookingRows, ticketRows, messageRows] = await Promise.all([
          tx
            .select({
              id: conversations.id,
              channel: conversations.channel,
              style: conversations.style,
              startedAt: conversations.startedAt,
              summary: conversations.summary,
            })
            .from(conversations)
            .where(eq(conversations.contactId, id))
            .orderBy(desc(conversations.startedAt))
            .limit(50),
          tx
            .select()
            .from(bookings)
            .where(eq(bookings.contactId, id))
            .orderBy(desc(bookings.startsAt))
            .limit(50),
          tx
            .select()
            .from(tickets)
            .where(eq(tickets.contactId, id))
            .orderBy(desc(tickets.createdAt))
            .limit(50),
          tx
            .select()
            .from(staffMessages)
            .where(eq(staffMessages.contactId, id))
            .orderBy(desc(staffMessages.createdAt))
            .limit(50),
        ]);
        return {
          contact: view(contact),
          conversations: calls.map((c) => ({
            id: c.id,
            channel: c.channel,
            style: c.style,
            startedAt: c.startedAt,
            outcome: (c.summary as { outcome?: string } | null)?.outcome ?? null,
          })),
          bookings: bookingRows.map((b) => ({
            id: b.id,
            reference: b.reference,
            service: b.service,
            startsAt: b.startsAt,
            status: b.status,
          })),
          tickets: ticketRows.map((t) => ({
            id: t.id,
            reference: t.reference,
            status: t.status,
            priority: t.priority,
            summary: t.summary,
            createdAt: t.createdAt,
          })),
          messages: messageRows.map((m) => ({
            id: m.id,
            reference: m.reference,
            reason: m.reason,
            status: m.status,
            createdAt: m.createdAt,
          })),
        };
      });
    },
  );

  r.post(
    "/api/tenants/:tenantId/contacts",
    { schema: { tags, summary: "Add a contact", params, body: editable } },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "contacts:write",
      );
      const values = await toValues(access.tenantId, request.body);
      if (!values.phoneE164 && !values.email) {
        throw new HttpError(
          400,
          "CONTACT_DETAILS_REQUIRED",
          "Add a phone number or an email address",
        );
      }
      try {
        const [row] = await withTenant(deps.db, access.tenantId, (tx) =>
          tx
            .insert(contacts)
            .values({ ...values, tenantId: access.tenantId, source: "manual" })
            .returning(),
        );
        return reply.status(201).send(view(row!));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new HttpError(
            409,
            "CONTACT_EXISTS",
            "A contact with this phone number already exists",
          );
        }
        throw error;
      }
    },
  );

  r.patch(
    "/api/tenants/:tenantId/contacts/:contactId",
    { schema: { tags, summary: "Edit a contact", params: contactParams, body: editable } },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "contacts:write",
      );
      const values = await toValues(access.tenantId, request.body);
      try {
        const [row] = await withTenant(deps.db, access.tenantId, (tx) =>
          tx
            .update(contacts)
            .set({ ...values, updatedAt: new Date() })
            .where(
              and(
                eq(contacts.id, request.params.contactId),
                eq(contacts.tenantId, access.tenantId),
              ),
            )
            .returning(),
        );
        if (!row) throw notFound();
        return view(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new HttpError(
            409,
            "CONTACT_EXISTS",
            "Another contact already has this phone number",
          );
        }
        throw error;
      }
    },
  );

  r.delete(
    "/api/tenants/:tenantId/contacts/:contactId",
    {
      schema: {
        tags,
        summary: "Delete a contact (their calls and records stay, unlinked)",
        params: contactParams,
      },
    },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "contacts:write",
      );
      const deleted = await withTenant(deps.db, access.tenantId, async (tx) => {
        const rows = await tx
          .delete(contacts)
          .where(
            and(eq(contacts.id, request.params.contactId), eq(contacts.tenantId, access.tenantId)),
          )
          .returning({ id: contacts.id });
        if (rows.length) {
          await recordAudit(tx, {
            tenantId: access.tenantId,
            actorType: "user",
            actorUserId: access.session.user.id,
            action: "contact.deleted",
            metadata: { contactId: rows[0]!.id },
          });
        }
        return rows.length;
      });
      if (!deleted) throw notFound();
      return reply.status(204).send();
    },
  );

  r.post(
    "/api/tenants/:tenantId/contacts/import/preview",
    {
      bodyLimit: 3_500_000,
      schema: {
        tags,
        summary: "Read a CSV: headers, a sample and the suggested column mapping",
        params,
        body: z.object({ csv: csvBody }),
      },
    },
    async (request) => {
      await requireTenantAccess(deps, request, request.params.tenantId, "contacts:write");
      const table = parseCsv(request.body.csv);
      const [headers = [], ...rows] = table;
      return {
        headers,
        sample: rows.slice(0, 5),
        rowCount: rows.length,
        maxRows: MAX_IMPORT_ROWS,
        mapping: guessMapping(headers),
      };
    },
  );

  r.post(
    "/api/tenants/:tenantId/contacts/import",
    {
      bodyLimit: 3_500_000,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags,
        summary: "Import contacts from CSV (dedupes by phone, then email)",
        params,
        body: z.object({ csv: csvBody, mapping: mappingSchema }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "contacts:write",
      );
      const [, ...rows] = parseCsv(request.body.csv);
      if (rows.length > MAX_IMPORT_ROWS) {
        throw new HttpError(400, "TOO_MANY_ROWS", `Import up to ${MAX_IMPORT_ROWS} rows at a time`);
      }
      if (request.body.mapping.phone === undefined && request.body.mapping.email === undefined) {
        throw new HttpError(400, "MAPPING_REQUIRED", "Choose the phone or email column");
      }
      const plan = planImport(rows, request.body.mapping, await country(access.tenantId));
      let created = 0;
      let updated = 0;
      await withTenant(deps.db, access.tenantId, async (tx) => {
        for (const row of plan.rows) {
          const [existing] = await tx
            .select()
            .from(contacts)
            .where(
              and(
                eq(contacts.tenantId, access.tenantId),
                row.phone ? eq(contacts.phoneE164, row.phone) : eq(contacts.email, row.email!),
              ),
            );
          if (existing) {
            // The file is the business's own data: it fills gaps and adds notes, and can
            // grant marketing consent, but never silently withdraws it.
            await tx
              .update(contacts)
              .set({
                fullName: row.fullName ?? existing.fullName,
                email: existing.email ?? row.email,
                phoneE164: existing.phoneE164 ?? row.phone,
                notes: row.notes ?? existing.notes,
                ...(row.marketingConsent && !existing.marketingConsent
                  ? { marketingConsent: true, consentAt: new Date() }
                  : {}),
                updatedAt: new Date(),
              })
              .where(eq(contacts.id, existing.id));
            updated++;
          } else {
            await tx.insert(contacts).values({
              tenantId: access.tenantId,
              fullName: row.fullName,
              phoneE164: row.phone,
              email: row.email,
              notes: row.notes,
              marketingConsent: row.marketingConsent,
              consentAt: row.marketingConsent ? new Date() : null,
              source: "import",
            });
            created++;
          }
        }
        await recordAudit(tx, {
          tenantId: access.tenantId,
          actorType: "user",
          actorUserId: access.session.user.id,
          action: "contacts.imported",
          metadata: { created, updated, rejected: plan.errors.length },
        });
      });
      return {
        created,
        updated,
        duplicatesInFile: plan.duplicatesInFile,
        errors: plan.errors.slice(0, 200),
        errorCount: plan.errors.length,
      };
    },
  );
}
