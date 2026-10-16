import { listUserTenants } from "@voicedesk/core";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { requireSession } from "./guards";

const meResponse = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
    twoFactorEnabled: z.boolean(),
    isPlatformOwner: z.boolean(),
  }),
  activeTenantId: z.string().nullable(),
  tenants: z.array(
    z.object({ tenantId: z.string(), name: z.string(), slug: z.string(), role: z.string() }),
  ),
});

export function registerMeRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/api/me",
    {
      schema: {
        tags: ["account"],
        security: [{ session: [] }],
        response: { 200: meResponse },
      },
    },
    async (request) => {
      const session = await requireSession(deps.auth, request);
      const { user } = session;
      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          twoFactorEnabled: Boolean(user.twoFactorEnabled),
          isPlatformOwner: Boolean(user.isPlatformOwner),
        },
        activeTenantId: session.session.activeOrganizationId ?? null,
        tenants: await listUserTenants(deps.db, user.id),
      };
    },
  );
}
