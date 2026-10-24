import { authRequestContext, type Auth } from "@voicedesk/auth";
import { recordAudit } from "@voicedesk/core";
import { user, type Database } from "@voicedesk/db";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";

/** Auth endpoints whose outcome is written to the audit log (security audit H6). */
const AUDITED: Record<string, { ok?: string; failed?: string }> = {
  "/api/auth/sign-in/email": { failed: "auth.login_failed" },
  "/api/auth/two-factor/enable": { ok: "auth.2fa_setup_started" },
  "/api/auth/two-factor/verify-totp": { failed: "auth.2fa_failed" },
  "/api/auth/two-factor/disable": { ok: "auth.2fa_disabled" },
  "/api/auth/change-password": { ok: "auth.password_changed", failed: "auth.password_change_failed" },
};

/** Mounts Better Auth's handler at /api/auth/* (per Better Auth's Fastify integration). */
export function registerAuthRoutes(app: FastifyInstance, auth: Auth, db: Database): void {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    schema: { hide: true },
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      const req = new Request(url, {
        method: request.method,
        headers: fromNodeHeaders(request.headers),
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      // Who is acting (for Better Auth's hooks), then run the request in that context.
      const session = request.method === "POST" ? await getSession(auth, request) : null;
      const actorUserId = session?.user.id ?? null;
      const response = await authRequestContext.run(
        { actorUserId, ipAddress: request.ip ?? null },
        () => auth.handler(req),
      );
      const audited = AUDITED[url.pathname];
      const action = audited && (response.ok ? audited.ok : audited.failed);
      if (action) {
        // Failed sign-ins name the account (if it exists) by id only, never the email (PII).
        let target = actorUserId;
        const email = (request.body as { email?: unknown } | null)?.email;
        if (!target && typeof email === "string") {
          const [found] = await db
            .select({ id: user.id })
            .from(user)
            .where(eq(user.email, email.trim().toLowerCase()));
          target = found?.id ?? null;
        }
        await db
          .transaction((tx) =>
            recordAudit(tx, {
              tenantId: null,
              actorType: "user",
              actorUserId: actorUserId ?? target,
              action,
              targetType: "user",
              targetId: target ?? undefined,
              metadata: { status: response.status },
              ipAddress: request.ip ?? null,
            }),
          )
          .catch((err: unknown) => request.log.warn({ err }, "auth audit failed"));
      }

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "set-cookie") void reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) void reply.header("set-cookie", cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}

export async function getSession(auth: Auth, request: FastifyRequest) {
  return auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
}
