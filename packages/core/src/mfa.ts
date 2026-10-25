import { can, type BusinessRole, type Permission } from "./permissions";

/**
 * Two-step login (MFA) policy (security audit C1):
 * - the platform owner needs it for Platform admin, immediately;
 * - business owners and admins need it for admin features (anything beyond what staff can do)
 *   after a 7-day grace period, counted from the rollout or from when the account was made,
 *   whichever is later. Staff-level features and the Account page stay usable, so they can
 *   always turn it on.
 */
export const MFA_ROLLOUT_AT = new Date("2026-10-24T00:00:00Z");
export const MFA_GRACE_DAYS = 7;

export function mfaDeadline(accountCreatedAt: Date): Date {
  const from = Math.max(accountCreatedAt.getTime(), MFA_ROLLOUT_AT.getTime());
  return new Date(from + MFA_GRACE_DAYS * 24 * 60 * 60 * 1000);
}

/** Whether this business action must be refused until two-step login is turned on. */
export function mfaBlocks(
  who: { twoFactorEnabled: boolean; createdAt: Date },
  role: BusinessRole,
  permission: Permission,
  now: Date = new Date(),
): boolean {
  if (who.twoFactorEnabled) return false;
  if (role === "staff" || can("staff", permission)) return false;
  return now.getTime() > mfaDeadline(who.createdAt).getTime();
}

export class MfaRequiredError extends Error {
  constructor() {
    super("Turn on two-step login on your Account page to use this.");
    this.name = "MfaRequiredError";
  }
}
