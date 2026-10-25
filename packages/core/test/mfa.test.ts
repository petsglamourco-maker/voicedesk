import { describe, expect, it } from "vitest";
import { MFA_ROLLOUT_AT, mfaBlocks, mfaDeadline } from "../src/mfa";

const day = 24 * 60 * 60 * 1000;
const rollout = MFA_ROLLOUT_AT.getTime();

describe("two-step login policy (audit C1)", () => {
  it("gives 7 days from the rollout, or from account creation if later", () => {
    expect(mfaDeadline(new Date(rollout - 100 * day)).getTime()).toBe(rollout + 7 * day);
    expect(mfaDeadline(new Date(rollout + 3 * day)).getTime()).toBe(rollout + 10 * day);
  });

  const old = { twoFactorEnabled: false, createdAt: new Date(rollout - 30 * day) };
  const after = new Date(rollout + 8 * day);
  const during = new Date(rollout + 2 * day);

  it("blocks owner/admin features without 2FA after the grace period", () => {
    expect(mfaBlocks(old, "owner", "agent:configure", after)).toBe(true);
    expect(mfaBlocks(old, "admin", "members:invite", after)).toBe(true);
  });

  it("never blocks during the grace period, staff, staff-level features or users with 2FA", () => {
    expect(mfaBlocks(old, "owner", "agent:configure", during)).toBe(false);
    expect(mfaBlocks(old, "staff", "records:write", after)).toBe(false);
    expect(mfaBlocks(old, "owner", "tenant:read", after)).toBe(false);
    expect(mfaBlocks(old, "owner", "inbox:reply", after)).toBe(false);
    expect(mfaBlocks({ ...old, twoFactorEnabled: true }, "owner", "agent:configure", after)).toBe(
      false,
    );
  });
});
