/**
 * Business-feature permissions per role. Organization-membership actions (invite, remove,
 * change role) are additionally enforced by Better Auth's access control (@voicedesk/auth).
 */

export const BUSINESS_ROLES = ["owner", "admin", "staff"] as const;
export type BusinessRole = (typeof BUSINESS_ROLES)[number];

export const PERMISSIONS = [
  "tenant:read",
  "tenant:update",
  "tenant:delete",
  "members:read",
  "members:invite",
  "members:update_role",
  "members:remove",
  "contacts:read",
  "contacts:write",
  "calls:read",
  "records:read",
  "records:write",
  "knowledge:read",
  "knowledge:write",
  "agent:test",
  "agent:configure",
  "compliance:manage",
  "billing:manage",
  "audit:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const OWNER_ONLY: ReadonlySet<Permission> = new Set(["tenant:delete", "billing:manage"]);

const STAFF: ReadonlySet<Permission> = new Set([
  "tenant:read",
  "members:read",
  "contacts:read",
  "contacts:write",
  "calls:read",
  "records:read",
  "records:write",
  "knowledge:read",
  "agent:test",
]);

const MATRIX: Record<BusinessRole, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS),
  admin: new Set(PERMISSIONS.filter((p) => !OWNER_ONLY.has(p))),
  staff: STAFF,
};

export function isBusinessRole(value: string): value is BusinessRole {
  return (BUSINESS_ROLES as readonly string[]).includes(value);
}

export function can(role: BusinessRole, permission: Permission): boolean {
  return MATRIX[role].has(permission);
}

export function permissionsFor(role: BusinessRole): Permission[] {
  return PERMISSIONS.filter((p) => MATRIX[role].has(p));
}

export class ForbiddenError extends Error {
  constructor(readonly permission: Permission) {
    super(`Missing permission: ${permission}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: BusinessRole, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(permission);
}
