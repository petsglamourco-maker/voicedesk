import { createHash } from "node:crypto";
import { verifyPassword } from "@voicedesk/auth";
import { listUserTenants, mfaDeadline, recordAudit } from "@voicedesk/core";
import { account } from "@voicedesk/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError } from "../lib/errors";
import { REAUTH_TTL_SECONDS } from "../lib/fresh-auth";
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
  /** Two-step login: whether this person must have it, and by when (business roles). */
  mfa: z.object({ required: z.boolean(), deadline: z.string().nullable() }),
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
      const tenants = await listUserTenants(deps.db, user.id);
      const admin = tenants.some((t) => t.role === "owner" || t.role === "admin");
      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          twoFactorEnabled: Boolean(user.twoFactorEnabled),
          isPlatformOwner: Boolean(user.isPlatformOwner),
        },
        mfa: {
          required: Boolean(user.isPlatformOwner) || admin,
          deadline:
            admin && !user.twoFactorEnabled
              ? mfaDeadline(new Date(user.createdAt)).toISOString()
              : null,
        },
        activeTenantId: session.session.activeOrganizationId ?? null,
        tenants,
      };
    },
  );

  /** Step-up re-authentication: confirm the password before sensitive admin actions (H6). */
  app.withTypeProvider<ZodTypeProvider>().post(
    "/api/me/reauth",
    {
      // Per session, not per IP: offices share an IP, and each session gets only 5 tries.
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
          keyGenerator: (request) =>
            `reauth:${createHash("sha256")
              .update(request.headers.cookie ?? request.ip)
              .digest("hex")}`,
        },
      },
      schema: {
        tags: ["account"],
        summary: "Confirm your password; sensitive admin actions are allowed for 5 minutes",
        security: [{ session: [] }],
        body: z.object({ password: z.string().min(1).max(200) }),
        response: { 200: z.object({ ok: z.literal(true), validForSeconds: z.number() }) },
      },
    },
    async (request) => {
      const session = await requireSession(deps.auth, request);
      const [credential] = await deps.db
        .select({ hash: account.password })
        .from(account)
        .where(and(eq(account.userId, session.user.id), eq(account.providerId, "credential")));
      const ok = credential?.hash
        ? await verifyPassword({ hash: credential.hash, password: request.body.password })
        : false;
      await deps.db.transaction((tx) =>
        recordAudit(tx, {
          tenantId: null,
          actorType: "user",
          actorUserId: session.user.id,
          action: ok ? "auth.reauth" : "auth.reauth_failed",
          targetType: "session",
          targetId: session.session.id,
          ipAddress: request.ip ?? null,
        }),
      );
      if (!ok) throw new HttpError(401, "WRONG_PASSWORD", "That password isn't right.");
      await deps.freshAuth.mark(session.session.id);
      return { ok: true as const, validForSeconds: REAUTH_TTL_SECONDS };
    },
  );
}
