import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { organization, twoFactor } from "better-auth/plugins";
import { account, type Database } from "@voicedesk/db";
import * as schema from "@voicedesk/db/schema";
import { and, eq } from "drizzle-orm";
import { breachCount, PASSWORD_FIELDS } from "./breach";
import { hashPassword, isCurrentHash, verifyPassword } from "./password";
import { ac, roles } from "./roles";

export interface AuthEmail {
  kind: "auth.verify" | "auth.invite" | "auth.reset" | "auth.alert";
  to: string;
  subject: string;
  text: string;
}

/** Security-relevant auth events, written to the audit log by the host app. */
export interface AuthAuditEvent {
  tenantId: string | null;
  actorUserId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/**
 * Who is making the current auth request, and from where. The host app sets it around each
 * Better Auth call, because Better Auth's organization hooks don't pass the acting user
 * (security audit H6: role changes and removals must name their actor).
 */
export const authRequestContext = new AsyncLocalStorage<{
  actorUserId: string | null;
  ipAddress: string | null;
}>();
const actor = () => authRequestContext.getStore()?.actorUserId ?? null;
const ip = () => authRequestContext.getStore()?.ipAddress ?? null;

export interface AuthDeps {
  db: Database;
  /** Public base URL the browser uses, e.g. http://localhost:3000 */
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  /** Delivers auth emails (verification, invitations). Should enqueue, not block. */
  sendEmail: (email: AuthEmail) => Promise<void>;
  audit: (event: AuthAuditEvent) => Promise<void>;
  /**
   * Refuse passwords found in known breaches (Have I Been Pwned; only the first 5 characters
   * of the password's SHA-1 are sent). On by default; tests switch it off (no network).
   */
  checkBreachedPasswords?: boolean;
  /** Called after someone is removed from a business (e.g. to disconnect their calendar). */
  onMemberRemoved?: (event: { tenantId: string; userId: string }) => Promise<void>;
  /** Told when the breach check couldn't run (the password was allowed). Never gets the password. */
  onBreachCheckUnavailable?: () => void;
  /**
   * Shared storage for Better Auth's own request limits (Valkey in the app). Without it the
   * limiter is off (tests; the API's own limiter still applies).
   */
  rateLimitStorage?: {
    consume: (
      key: string,
      rule: { window: number; max: number },
    ) => Promise<{ allowed: boolean; retryAfter: number | null }>;
  };
}

/**
 * Better Auth's per-IP limits on the sensitive endpoints (security audit H4). Generous
 * enough for an office behind one IP; account lockout handles password guessing.
 */
export const AUTH_RATE_LIMITS = {
  "/sign-in/email": { window: 60, max: 20 },
  "/sign-up/email": { window: 600, max: 30 },
  "/request-password-reset": { window: 600, max: 5 },
  "/reset-password": { window: 600, max: 10 },
  "/change-password": { window: 600, max: 10 },
  "/two-factor/verify-totp": { window: 60, max: 10 },
  "/two-factor/verify-backup-code": { window: 600, max: 10 },
} as const;

/** Sessions end after 7 days without use; an active session is extended once a day. */
export const SESSION_EXPIRES_SECONDS = 7 * 24 * 60 * 60;
/** Password reset links work once, for 30 minutes. */
export const RESET_LINK_SECONDS = 30 * 60;

/**
 * Moves an account from the old scrypt hash to Argon2id after a successful sign-in
 * (the only moment the plain password is known). No-op when already upgraded.
 */
export async function upgradePasswordHash(
  db: Database,
  userId: string,
  password: string,
): Promise<boolean> {
  const where = and(eq(account.userId, userId), eq(account.providerId, "credential"));
  const [row] = await db.select({ hash: account.password }).from(account).where(where);
  if (!row?.hash || isCurrentHash(row.hash)) return false;
  if (!(await verifyPassword({ hash: row.hash, password }))) return false;
  await db
    .update(account)
    .set({ password: await hashPassword(password) })
    .where(where);
  return true;
}

export { hashPassword, verifyPassword } from "./password";
export { breachCount } from "./breach";

export function createAuth(deps: AuthDeps) {
  const { baseURL } = deps;

  return betterAuth({
    appName: "VoiceDesk",
    baseURL,
    basePath: "/api/auth",
    secret: deps.secret,
    trustedOrigins: deps.trustedOrigins,
    telemetry: { enabled: false },
    database: drizzleAdapter(deps.db, { provider: "pg", schema }),
    advanced: {
      database: { generateId: "uuid" },
      // Secure cookies whenever VoiceDesk is served over https (security audit M4).
      useSecureCookies: baseURL.startsWith("https://"),
      // The host app sets this header to the client IP it resolved through trusted proxies.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    hooks: {
      // Refuse passwords from known breaches (security audit H5). If the service can't be
      // reached in 3 seconds the password is allowed: an outage must not lock people out.
      before: createAuthMiddleware(async (ctx) => {
        const field = PASSWORD_FIELDS[ctx.path];
        if (!field || deps.checkBreachedPasswords === false) return;
        const password = (ctx.body as Record<string, unknown> | undefined)?.[field];
        if (typeof password !== "string") return;
        const count = await breachCount(password);
        if (count === null) deps.onBreachCheckUnavailable?.();
        else if (count > 0) {
          throw new APIError("BAD_REQUEST", {
            code: "PASSWORD_COMPROMISED",
            message:
              "This password has appeared in a data breach, so it isn't safe. Please choose a different one.",
          });
        }
      }),
    },
    rateLimit: deps.rateLimitStorage
      ? {
          enabled: true,
          window: 60,
          max: 200,
          customRules: AUTH_RATE_LIMITS,
          customStorage: deps.rateLimitStorage,
        }
      : { enabled: false },
    session: {
      expiresIn: SESSION_EXPIRES_SECONDS,
      updateAge: 24 * 60 * 60,
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await deps.audit({
              tenantId: null,
              actorUserId: session.userId,
              action: "auth.session_created",
              targetType: "session",
              targetId: session.id,
              ipAddress: ip(),
            });
          },
        },
      },
    },
    user: {
      additionalFields: {
        isPlatformOwner: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false, // only settable by the seed script / platform tooling
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      password: { hash: hashPassword, verify: verifyPassword },
      resetPasswordTokenExpiresIn: RESET_LINK_SECONDS,
      // A reset signs out every device: whoever had the old password loses access.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await deps.sendEmail({
          kind: "auth.reset",
          to: user.email,
          subject: "Reset your VoiceDesk password",
          text: `Hi ${user.name},

Someone (hopefully you) asked to reset your VoiceDesk password. Choose a new one here:
${url}

The link works once and expires in 30 minutes. Resetting signs you out on every device.

If you didn't ask for this, you can ignore this email: your password hasn't changed.`,
        });
      },
      onPasswordReset: async ({ user }) => {
        await deps.audit({
          tenantId: null,
          actorUserId: user.id,
          action: "auth.password_reset",
          targetType: "user",
          targetId: user.id,
          ipAddress: ip(),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await deps.sendEmail({
          kind: "auth.verify",
          to: user.email,
          subject: "Verify your VoiceDesk email address",
          text: `Hi ${user.name},\n\nConfirm your email address to finish setting up VoiceDesk:\n${url}\n\nIf you didn't sign up, you can ignore this email.`,
        });
      },
    },
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: "owner",
        allowUserToCreateOrganization: true,
        // One request must never hard-delete a business and all its data (security audit H1).
        // Deleting a business will be a separate, re-authenticated flow with a grace period.
        disableOrganizationDeletion: true,
        requireEmailVerificationOnInvitation: true,
        invitationExpiresIn: 60 * 60 * 24 * 7,
        sendInvitationEmail: async (data) => {
          const link = `${baseURL}/accept-invite/${data.id}`;
          await deps.sendEmail({
            kind: "auth.invite",
            to: data.email,
            subject: `You've been invited to ${data.organization.name} on VoiceDesk`,
            text: `${data.inviter.user.name} invited you to join ${data.organization.name} as ${data.role}.\n\nAccept the invitation:\n${link}\n\nThis link expires in 7 days.`,
          });
        },
        organizationHooks: {
          afterCreateInvitation: ({ invitation, inviter, organization }) =>
            deps.audit({
              tenantId: organization.id,
              actorUserId: inviter.id,
              action: "member.invited",
              targetType: "invitation",
              targetId: invitation.id,
              metadata: { role: invitation.role },
            }),
          afterCancelInvitation: ({ invitation, cancelledBy, organization }) =>
            deps.audit({
              tenantId: organization.id,
              actorUserId: cancelledBy.id,
              action: "member.invitation_cancelled",
              targetType: "invitation",
              targetId: invitation.id,
            }),
          afterAcceptInvitation: ({ invitation, member, user, organization }) =>
            deps.audit({
              tenantId: organization.id,
              actorUserId: user.id,
              action: "member.joined",
              targetType: "member",
              targetId: member.id,
              metadata: { invitationId: invitation.id, role: member.role },
            }),
          // Better Auth doesn't pass the acting user to these hooks: it comes from the request
          // context the host app sets (authRequestContext).
          afterUpdateMemberRole: ({ member, previousRole, organization }) =>
            deps.audit({
              tenantId: organization.id,
              actorUserId: actor(),
              ipAddress: ip(),
              action: "member.role_changed",
              targetType: "member",
              targetId: member.id,
              metadata: { from: previousRole, to: member.role },
            }),
          afterRemoveMember: async ({ member, organization }) => {
            await deps.audit({
              tenantId: organization.id,
              actorUserId: actor(),
              ipAddress: ip(),
              action: "member.removed",
              targetType: "member",
              targetId: member.id,
            });
            await deps.onMemberRemoved?.({ tenantId: organization.id, userId: member.userId });
          },
        },
      }),
      twoFactor({ issuer: "VoiceDesk" }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;
export { ac, roles } from "./roles";
