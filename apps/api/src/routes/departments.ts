import {
  checkDestination,
  destinationMessage,
  getPlatformSpendSettings,
  menuLine,
  normalisePhone,
  toRouting,
} from "@voicedesk/agent-brain";
import { can, getPlanState, planAllows, recordAudit, requireFeature } from "@voicedesk/core";
import {
  agentSettings,
  departmentMembers,
  departments,
  member,
  tenants,
  user,
  withTenant,
} from "@voicedesk/db";
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError } from "../lib/errors";
import { requireTenantAccess } from "./guards";

/**
 * Departments and the phone menu (ADR 0025). The business saves its whole menu at once:
 * which key is which department, what the assistant should know, who deals with it (its
 * VoiceDesk people, a transfer number, an email, or any mix) and an optional payment link.
 */

const params = z.object({ tenantId: z.string() });
const ROUTINGS = ["people_then_phone", "people_only", "phone_only", "message_only"] as const;
const LANGS = ["en", "es", "fr", "de", "zh", "ar"] as const;
const MAX = 9;

const departmentInput = z.object({
  id: z.string().uuid().optional(),
  key: z.number().int().min(1).max(9),
  name: z.string().trim().min(1).max(40),
  spokenNames: z.partialRecord(z.enum(LANGS), z.string().trim().max(40)).default({}),
  instructions: z.string().trim().max(1000).nullable().default(null),
  routing: z.enum(ROUTINGS).default("people_then_phone"),
  transferPhone: z.string().trim().max(40).nullable().default(null),
  notifyEmail: z.string().trim().email().max(200).nullable().default(null),
  paymentLink: z
    .string()
    .trim()
    .max(500)
    .url()
    .refine((u) => u.startsWith("https://"), "Payment links must start with https://")
    .nullable()
    .default(null),
  ringFirst: z.boolean().default(false),
  enabled: z.boolean().default(true),
  memberIds: z.array(z.string().uuid()).max(100).default([]),
});

const menuBody = z.object({
  menuEnabled: z.boolean(),
  menuHours: z.enum(["always", "open"]),
  menuOnChat: z.boolean(),
  departments: z.array(departmentInput).max(MAX),
});

type DepartmentRow = typeof departments.$inferSelect;

export function registerDepartmentRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function view(tenantId: string, canEdit: boolean) {
    const data = await withTenant(deps.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(departments)
        .where(eq(departments.tenantId, tenantId))
        .orderBy(asc(departments.position), asc(departments.key));
      const members = await tx
        .select()
        .from(departmentMembers)
        .where(eq(departmentMembers.tenantId, tenantId));
      const [settings] = await tx
        .select()
        .from(agentSettings)
        .where(eq(agentSettings.tenantId, tenantId));
      return { rows, members, settings };
    });
    const allowed = planAllows(await getPlanState(deps.db, tenantId), "departments");
    // The business's people, to choose who belongs to each department.
    const team = await deps.db
      .select({ userId: member.userId, name: user.name })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, tenantId))
      .orderBy(asc(user.name));
    const list = data.rows.map((d: DepartmentRow) => ({
      id: d.id,
      key: d.key,
      name: d.name,
      spokenNames: d.spokenNames,
      instructions: d.instructions,
      routing: toRouting(d.routing),
      transferPhone: d.transferPhone,
      notifyEmail: d.notifyEmail,
      paymentLink: d.paymentLink,
      ringFirst: d.ringFirst,
      enabled: d.enabled,
      memberIds: data.members.filter((m) => m.departmentId === d.id).map((m) => m.userId),
    }));
    const live = list.filter((d) => d.enabled);
    return {
      menuEnabled: data.settings?.menuEnabled ?? false,
      menuHours: data.settings?.menuHours === "open" ? "open" : "always",
      menuOnChat: data.settings?.menuOnChat ?? false,
      departments: list,
      /** What callers hear after the greeting (English preview). */
      preview: live.length ? menuLine("en", live) : null,
      team,
      planAllows: allowed,
      canEdit,
    };
  }

  r.get(
    "/api/tenants/:tenantId/departments",
    { schema: { tags: ["departments"], summary: "Departments and the phone menu", params } },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "tenant:read",
      );
      return view(access.tenantId, can(access.role, "agent:configure"));
    },
  );

  r.put(
    "/api/tenants/:tenantId/departments",
    {
      schema: {
        tags: ["departments"],
        summary: "Save the departments and phone menu (owners and admins)",
        params,
        body: menuBody,
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:configure",
      );
      const tenantId = access.tenantId;
      const body = request.body;
      if (body.departments.length > 0 || body.menuEnabled || body.menuOnChat) {
        await requireFeature(deps.db, tenantId, "departments");
      }
      const keys = body.departments.map((d) => d.key);
      if (new Set(keys).size !== keys.length) {
        throw new HttpError(400, "DUPLICATE_KEY", "Each department needs its own key (1–9).");
      }
      if (body.menuEnabled && !body.departments.some((d) => d.enabled)) {
        throw new HttpError(400, "NO_DEPARTMENTS", "Add at least one department first.");
      }

      // Transfer numbers: valid, allowed countries, no premium numbers (ADR 0022).
      const [tenant] = await withTenant(deps.db, tenantId, (tx) =>
        tx.select({ c: tenants.countryCode }).from(tenants).where(eq(tenants.id, tenantId)),
      );
      const { allowedCountries } = await getPlatformSpendSettings(deps.db);
      const phoneOf = (value: string | null, name: string) => {
        if (!value) return null;
        const e164 = normalisePhone(value, tenant?.c ?? "GB");
        if (!e164)
          throw new HttpError(400, "INVALID_PHONE", `${name}: the phone number isn't valid`);
        const check = checkDestination(e164, allowedCountries);
        if (!check.ok) {
          throw new HttpError(
            400,
            "PHONE_NOT_ALLOWED",
            `${name}: the number can't be used: ${destinationMessage(check.reason)}`,
          );
        }
        return e164;
      };
      const prepared = body.departments.map((d, position) => ({
        ...d,
        position,
        transferPhone: phoneOf(d.transferPhone, d.name),
      }));

      // Only this business's members can be in its departments.
      const memberIds = [...new Set(prepared.flatMap((d) => d.memberIds))];
      if (memberIds.length) {
        const found = await deps.db
          .select({ userId: member.userId })
          .from(member)
          .where(and(eq(member.organizationId, tenantId), inArray(member.userId, memberIds)));
        if (found.length !== memberIds.length) {
          throw new HttpError(400, "NOT_A_MEMBER", "Only members of this business can be added.");
        }
      }

      let paymentLinksChanged = false;
      await withTenant(deps.db, tenantId, async (tx) => {
        const existing = await tx
          .select()
          .from(departments)
          .where(eq(departments.tenantId, tenantId));
        const byId = new Map(existing.map((d) => [d.id, d]));
        for (const d of prepared) {
          if (d.id && !byId.has(d.id))
            throw new HttpError(404, "NOT_FOUND", "Department not found");
        }
        const keep = prepared.flatMap((d) => (d.id ? [d.id] : []));
        // Removed departments: calls keep their history (department set to none).
        await tx
          .delete(departments)
          .where(
            keep.length
              ? and(eq(departments.tenantId, tenantId), notInArray(departments.id, keep))
              : eq(departments.tenantId, tenantId),
          );
        // Keys are unique per business: park the kept ones first so keys can be swapped.
        for (const id of keep) {
          await tx
            .update(departments)
            .set({ key: -1 - keep.indexOf(id) })
            .where(eq(departments.id, id));
        }
        for (const d of prepared) {
          const values = {
            key: d.key,
            name: d.name,
            spokenNames: d.spokenNames as Record<string, string>,
            instructions: d.instructions || null,
            routing: d.routing,
            transferPhone: d.transferPhone,
            notifyEmail: d.notifyEmail,
            paymentLink: d.paymentLink,
            ringFirst: d.ringFirst,
            enabled: d.enabled,
            position: d.position,
            updatedAt: new Date(),
          };
          const before = d.id ? byId.get(d.id) : undefined;
          if ((before?.paymentLink ?? null) !== d.paymentLink) paymentLinksChanged = true;
          let id = d.id;
          if (id) {
            await tx.update(departments).set(values).where(eq(departments.id, id));
          } else {
            const [row] = await tx
              .insert(departments)
              .values({ tenantId, ...values })
              .returning({ id: departments.id });
            id = row!.id;
          }
          await tx.delete(departmentMembers).where(eq(departmentMembers.departmentId, id));
          if (d.memberIds.length) {
            await tx
              .insert(departmentMembers)
              .values(d.memberIds.map((userId) => ({ tenantId, departmentId: id, userId })));
          }
        }
        if (existing.some((d) => d.paymentLink && !keep.includes(d.id))) paymentLinksChanged = true;
        const settings = {
          menuEnabled: body.menuEnabled,
          menuHours: body.menuHours,
          menuOnChat: body.menuOnChat,
        };
        await tx
          .insert(agentSettings)
          .values({ tenantId, ...settings })
          .onConflictDoUpdate({ target: agentSettings.tenantId, set: settings });
        await recordAudit(tx, {
          tenantId,
          actorType: "user",
          actorUserId: access.session.user.id,
          action: "departments.updated",
          metadata: {
            departments: prepared.length,
            menuEnabled: body.menuEnabled,
            menuOnChat: body.menuOnChat,
            paymentLinksChanged,
          },
          ipAddress: request.ip ?? null,
        });
      });
      return view(tenantId, true);
    },
  );
}
