import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * Organization-management permissions enforced by Better Auth (inviting, removing members,
 * changing roles...). Business-feature permissions live in @voicedesk/core/permissions.
 */
export const ac = createAccessControl(defaultStatements);

export const roles = {
  owner: ac.newRole({ ...ownerAc.statements }),
  admin: ac.newRole({ ...adminAc.statements }),
  staff: ac.newRole({ ...memberAc.statements }),
};

export type BusinessRole = keyof typeof roles;
export const BUSINESS_ROLES = Object.keys(roles) as BusinessRole[];
