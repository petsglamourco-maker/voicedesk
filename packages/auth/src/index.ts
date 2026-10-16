import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization, twoFactor } from "better-auth/plugins";
import type { Database } from "@voicedesk/db";
import * as schema from "@voicedesk/db/schema";
import { ac, roles } from "./roles";

export interface AuthEmail {
  to: string;
  subject: string;
  text: string;
}

export interface AuthDeps {
  db: Database;
  /** Public base URL the browser uses, e.g. http://localhost:3000 */
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  /** Delivers auth emails (verification, invitations). Should enqueue, not block. */
  sendEmail: (email: AuthEmail) => Promise<void>;
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
            to: data.email,
            subject: `You've been invited to ${data.organization.name} on VoiceDesk`,
            text: `${data.inviter.user.name} invited you to join ${data.organization.name} as ${data.role}.\n\nAccept the invitation:\n${link}\n\nThis link expires in 7 days.`,
          });
        },
      }),
      twoFactor({ issuer: "VoiceDesk" }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;
export { ac, roles } from "./roles";
