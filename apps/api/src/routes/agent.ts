import { LANGUAGES, PERSONA_IDS, PERSONAS } from "@voicedesk/agent-brain";
import { recordAudit } from "@voicedesk/core";
import { agentSettings, bookings, staffMessages, tickets, withTenant } from "@voicedesk/db";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { requireTenantAccess } from "./guards";

const params = z.object({ tenantId: z.string() });

const settingsSchema = z.object({
  personaId: z.enum(PERSONA_IDS as [string, ...string[]]),
  personaNames: z.record(z.string(), z.string().trim().min(1).max(40)),
  enabledLanguages: z.array(z.enum(LANGUAGES)).min(1),
  adminLanguage: z.enum(LANGUAGES),
});

const settingsResponse = z.object({
  personaId: z.string(),
  personaNames: z.record(z.string(), z.string()),
  enabledLanguages: z.array(z.string()),
  adminLanguage: z.string(),
});

const DEFAULTS = {
  personaId: "amelia",
  personaNames: {} as Record<string, string>,
  enabledLanguages: [...LANGUAGES] as string[],
  adminLanguage: "en",
};

export function registerAgentRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/tenants/:tenantId/agent",
    {
      schema: {
        tags: ["agent"],
        summary: "Agent settings and the available personas",
        params,
        response: {
          200: z.object({
            settings: settingsResponse,
            personas: z.array(
              z.object({
                id: z.string(),
                defaultName: z.string(),
                gender: z.string(),
                style: z.string(),
                bestFor: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:test",
      );
      const [row] = await withTenant(deps.db, access.tenantId, (tx) =>
        tx.select().from(agentSettings).where(eq(agentSettings.tenantId, access.tenantId)),
      );
      return {
        settings: row
          ? {
              personaId: row.personaId,
              personaNames: row.personaNames,
              enabledLanguages: row.enabledLanguages,
              adminLanguage: row.adminLanguage,
            }
          : DEFAULTS,
        personas: Object.values(PERSONAS),
      };
    },
  );

  r.put(
    "/api/tenants/:tenantId/agent",
    { schema: { tags: ["agent"], params, body: settingsSchema } },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:configure",
      );
      const values = { ...request.body, tenantId: access.tenantId };
      await withTenant(deps.db, access.tenantId, async (tx) => {
        await tx
          .insert(agentSettings)
          .values(values)
          .onConflictDoUpdate({ target: agentSettings.tenantId, set: request.body });
        await recordAudit(tx, {
          tenantId: access.tenantId,
          actorType: "user",
          actorUserId: access.session.user.id,
          action: "agent.settings_updated",
          metadata: { personaId: request.body.personaId },
        });
      });
      return reply.status(204).send();
    },
  );

  r.get(
    "/api/tenants/:tenantId/records",
    {
      schema: {
        tags: ["records"],
        summary: "Recent tickets, messages and bookings created by the agent",
        params,
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "records:read",
      );
      return withTenant(deps.db, access.tenantId, async (tx) => ({
        tickets: await tx
          .select()
          .from(tickets)
          .where(eq(tickets.tenantId, access.tenantId))
          .orderBy(desc(tickets.createdAt))
          .limit(50),
        messages: await tx
          .select()
          .from(staffMessages)
          .where(eq(staffMessages.tenantId, access.tenantId))
          .orderBy(desc(staffMessages.createdAt))
          .limit(50),
        bookings: await tx
          .select()
          .from(bookings)
          .where(eq(bookings.tenantId, access.tenantId))
          .orderBy(desc(bookings.startsAt))
          .limit(50),
      }));
    },
  );
}
