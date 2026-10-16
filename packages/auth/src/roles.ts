import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";
import type { BusinessRole } from "@voicedesk/core";

/**
 * Organization-management permissions enforced by Better Auth (inviting, removing members,
 * changing roles...). Business-feature permissions live in @voicedesk/core/permissions.
 */
export const ac = createAccessControl(defaultStatements);

export const roles = {
  owner: ac.newRole({ ...ownerAc.statements }),
  admin: ac.newRole({ ...adminAc.statements }),
  staff: ac.newRole({ ...memberAc.statements }),
} satisfies Record<BusinessRole, unknown>;
