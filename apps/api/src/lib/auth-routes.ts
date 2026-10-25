import {
  authRequestContext,
  upgradePasswordHash,
  type Auth,
  type AuthEmail,
} from "@voicedesk/auth";
import { recordAudit, type AuditEntry } from "@voicedesk/core";
import { user, type Database } from "@voicedesk/db";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { FreshAuthStore } from "./fresh-auth";
import type { Kv } from "./kv";
import {
  clearFailedSignIns,
  lockedEmail,
  lockedFor,
  newDeviceEmail,
  noteDevice,
  recordFailedSignIn,
} from "./sign-in-guard";

/** Auth endpoints whose outcome is written to the audit log (security audit H6). */
const AUDITED: Record<string, { ok?: string; failed?: string }> = {
  "/api/auth/sign-in/email": { failed: "auth.login_failed" },
  "/api/auth/two-factor/enable": { ok: "auth.2fa_setup_started" },
  "/api/auth/two-factor/verify-totp": { failed: "auth.2fa_failed" },
  "/api/auth/two-factor/disable": { ok: "auth.2fa_disabled" },
  "/api/auth/change-password": {
    ok: "auth.password_changed",
    failed: "auth.password_change_failed",
  },
  "/api/auth/request-password-reset": { ok: "auth.password_reset_requested" },
  "/api/auth/reset-password": { failed: "auth.password_reset_failed" },
  "/api/auth/revoke-session": { ok: "auth.session_revoked" },
  "/api/auth/revoke-other-sessions": { ok: "auth.sessions_revoked" },
  "/api/auth/revoke-sessions": { ok: "auth.sessions_revoked" },
};

const SIGN_IN = "/api/auth/sign-in/email";
const VERIFY_TOTP = "/api/auth/two-factor/verify-totp";

/**
 * Team changes that need the password confirmed in the last few minutes (security audit H6):
 * changing roles, removing people, and inviting owners or admins.
 */
function needsFreshAuth(pathname: string, body: unknown): boolean {
  if (
    pathname === "/api/auth/organization/update-member-role" ||
    pathname === "/api/auth/organization/remove-member"
  ) {
    return true;
  }
  const role = (body as { role?: unknown } | null)?.role;
  return pathname === "/api/auth/organization/invite-member" && role !== "staff";
}

export interface AuthRouteDeps {
  auth: Auth;
  db: Database;
  freshAuth: FreshAuthStore;
  kv: Kv;
  /** Security alerts to account holders (lockout, new device). */
  sendAuthEmail: (email: AuthEmail) => Promise<void>;
  webOrigin?: string;
}

/** Mounts Better Auth's handler at /api/auth/* (per Better Auth's Fastify integration). */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const { auth, db, kv } = deps;
  const webOrigin = deps.webOrigin ?? "http://localhost:3000";

  async function userByEmail(email: unknown) {
    if (typeof email !== "string") return null;
    const [found] = await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(eq(user.email, email.trim().toLowerCase()));
    return found ?? null;
  }

  async function audit(request: FastifyRequest, entry: Omit<AuditEntry, "ipAddress">) {
    await db
      .transaction((tx) => recordAudit(tx, { ...entry, ipAddress: request.ip ?? null }))
      .catch((err: unknown) => request.log.warn({ err }, "auth audit failed"));
  }

  /** After a completed sign-in: clear failures, upgrade the hash, alert on a new device. */
  async function afterSignIn(
    request: FastifyRequest,
    account: { id: string; email: string },
    password?: string,
  ) {
    await clearFailedSignIns(kv, account.id);
    if (password) await upgradePasswordHash(db, account.id, password);
    const userAgent = request.headers["user-agent"];
    if (await noteDevice(db, account.id, userAgent)) {
      await deps.sendAuthEmail(newDeviceEmail(account.email, userAgent, request.ip, webOrigin));
      await audit(request, {
        tenantId: null,
        actorType: "user",
        actorUserId: account.id,
        action: "auth.new_device",
        targetType: "user",
        targetId: account.id,
      });
    }
  }

  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    schema: { hide: true },
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      const headers = fromNodeHeaders(request.headers);
      // Better Auth's own limits key on this header: give it the address Fastify resolved
      // through trusted proxies only, never a value the browser sent (security audit H4).
      headers.set("x-forwarded-for", request.ip);
      const req = new Request(url, {
        method: request.method,
        headers,
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const body = request.body as { email?: unknown; password?: unknown } | null;

      // A locked account can't sign in, even with the right password, until the lock ends.
      const signingIn = url.pathname === SIGN_IN ? await userByEmail(body?.email) : null;
      if (signingIn) {
        const seconds = await lockedFor(kv, signingIn.id);
        if (seconds !== null) {
          await audit(request, {
            tenantId: null,
            actorType: "user",
            actorUserId: signingIn.id,
            action: "auth.login_blocked",
            targetType: "user",
            targetId: signingIn.id,
          });
          return reply.status(429).send({
            code: "ACCOUNT_LOCKED",
            error: "ACCOUNT_LOCKED",
            message: `Too many wrong passwords. Sign-in to this account is paused for ${Math.ceil(seconds / 60)} more minutes, or reset your password.`,
          });
        }
      }

      // Who is acting (for Better Auth's hooks), then run the request in that context.
      const session = request.method === "POST" ? await getSession(auth, request) : null;
      const actorUserId = session?.user.id ?? null;
      if (
        session &&
        needsFreshAuth(url.pathname, request.body) &&
        !(await deps.freshAuth.isFresh(session.session.id))
      ) {
        return reply.status(403).send({
          code: "REAUTH_REQUIRED",
          error: "REAUTH_REQUIRED",
          message: "Please enter your password again to do this.",
        });
      }
      // nosemgrep: ajinabraham.njsscan.xss.xss_node.express_xss -- reviewed: Better Auth's own response, passed through with its own content type
      const response = await authRequestContext.run(
        { actorUserId, ipAddress: request.ip ?? null },
        () => auth.handler(req),
      );

      const audited = AUDITED[url.pathname];
      const action = audited && (response.ok ? audited.ok : audited.failed);
      if (action) {
        // Failed sign-ins name the account (if it exists) by id only, never the email (PII).
        const target = actorUserId ?? signingIn?.id ?? (await userByEmail(body?.email))?.id ?? null;
        await audit(request, {
          tenantId: null,
          actorType: "user",
          actorUserId: target,
          action,
          targetType: "user",
          targetId: target ?? undefined,
          metadata: { status: response.status },
        });
      }

      try {
        if (signingIn && response.status === 401 && (await recordFailedSignIn(kv, signingIn.id))) {
          await deps.sendAuthEmail(lockedEmail(signingIn.email, webOrigin));
          await audit(request, {
            tenantId: null,
            actorType: "user",
            actorUserId: signingIn.id,
            action: "auth.account_locked",
            targetType: "user",
            targetId: signingIn.id,
          });
        }
        if (signingIn && response.ok) {
          const result = (await response.clone().json()) as { twoFactorRedirect?: boolean };
          const password = typeof body?.password === "string" ? body.password : undefined;
          // With two-step login the sign-in completes at verify-totp; the hash can move now.
          if (result.twoFactorRedirect) {
            if (password) await upgradePasswordHash(db, signingIn.id, password);
          } else {
            await afterSignIn(request, signingIn, password);
          }
        }
        if (url.pathname === VERIFY_TOTP && response.ok) {
          const result = (await response.clone().json()) as {
            user?: { id: string; email: string };
          };
          if (result.user) await afterSignIn(request, result.user);
        }
      } catch (err) {
        request.log.warn({ err }, "sign-in follow-up failed");
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
