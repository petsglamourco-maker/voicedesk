import type { Auth } from "@voicedesk/auth";
import {
  assertCan,
  getMembershipRole,
  mfaBlocks,
  MfaRequiredError,
  type BusinessRole,
  type Permission,
} from "@voicedesk/core";
import { isUuid, type Database } from "@voicedesk/db";
import type { FastifyRequest } from "fastify";
import { getSession } from "../lib/auth-routes";
import { notFound, unauthorized } from "../lib/errors";

export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

export async function requireSession(auth: Auth, request: FastifyRequest): Promise<Session> {
  const session = await getSession(auth, request);
  if (!session) throw unauthorized();
  return session;
}

export interface TenantAccess {
  session: Session;
  tenantId: string;
  role: BusinessRole;
}

/**
 * Authorizes the signed-in user for a tenant and permission. Must run before any
 * withTenant() call on behalf of the user. Non-members get 404, not 403.
 */
export async function requireTenantAccess(
  deps: { auth: Auth; db: Database },
  request: FastifyRequest,
  tenantId: string,
  permission: Permission,
): Promise<TenantAccess> {
  const session = await requireSession(deps.auth, request);
  if (!isUuid(tenantId)) throw notFound();
  const role = await getMembershipRole(deps.db, session.user.id, tenantId);
  if (!role) throw notFound();
  assertCan(role, permission);
  // Owners and admins need two-step login for admin features after the grace period (C1).
  if (
    mfaBlocks(
      {
        twoFactorEnabled: Boolean(session.user.twoFactorEnabled),
        createdAt: new Date(session.user.createdAt),
      },
      role,
      permission,
    )
  ) {
    throw new MfaRequiredError();
  }
  return { session, tenantId, role };
}
