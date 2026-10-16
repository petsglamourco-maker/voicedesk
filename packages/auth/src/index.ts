import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization, twoFactor } from "better-auth/plugins";
import type { Database } from "@voicedesk/db";
import * as schema from "@voicedesk/db/schema";
import { ac, roles } from "./roles";

export interface AuthEmail {
  kind: "auth.verify" | "auth.invite";
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
}

export interface AuthDeps {
  db: Database;
  /** Public base URL the browser uses, e.g. http://localhost:3000 */
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  /** Delivers auth emails (verification, invitations). Should enqueue, not block. */
  sendEmail: (email: AuthEmail) => Promise<void>;
  audit: (event: AuthAuditEvent) => Promise<void>;
}

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
          // Better Auth doesn't pass the acting user to these hooks; the request is still
          // authorized by its access control. Actor attribution is added in Phase 7 hardening.
          afterUpdateMemberRole: ({ member, previousRole, organization }) =>
            deps.audit({
              tenantId: organization.id,
              actorUserId: null,
              action: "member.role_changed",
              targetType: "member",
              targetId: member.id,
              metadata: { from: previousRole, to: member.role },
            }),
          afterRemoveMember: ({ member, organization }) =>
            deps.audit({
              tenantId: organization.id,
              actorUserId: null,
              action: "member.removed",
              targetType: "member",
              targetId: member.id,
            }),
        },
      }),
      twoFactor({ issuer: "VoiceDesk" }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;
export { ac, roles } from "./roles";
