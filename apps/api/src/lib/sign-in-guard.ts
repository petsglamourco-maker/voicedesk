import { createHash } from "node:crypto";
import type { AuthEmail } from "@voicedesk/auth";
import { describeDevice, deviceKey } from "@voicedesk/auth/devices";
import { knownDevices, type Database } from "@voicedesk/db";
import { and, eq, sql } from "drizzle-orm";
import type { Kv } from "./kv";

/**
 * Account lockout (security audit H4): 10 wrong passwords within 15 minutes pause sign-in
 * to that account for 15 minutes, even with the right password, and email the account
 * holder. Counted per account, so changing IP doesn't help an attacker.
 */
export const LOCK_AFTER_FAILURES = 10;
export const LOCK_SECONDS = 15 * 60;

const failuresKey = (userId: string) => `signin-fail:${userId}`;
const lockKey = (userId: string) => `signin-lock:${userId}`;

/** Seconds left on a lock, or null when the account isn't locked. */
export function lockedFor(kv: Kv, userId: string): Promise<number | null> {
  return kv.ttl(lockKey(userId));
}

/** Counts a wrong password; true when this failure locked the account. */
export async function recordFailedSignIn(kv: Kv, userId: string): Promise<boolean> {
  const failures = await kv.incr(failuresKey(userId), LOCK_SECONDS);
  if (failures !== LOCK_AFTER_FAILURES) return false;
  await kv.set(lockKey(userId), "1", LOCK_SECONDS);
  await kv.del(failuresKey(userId));
  return true;
}

export function clearFailedSignIns(kv: Kv, userId: string): Promise<void> {
  return kv.del(failuresKey(userId));
}

export function lockedEmail(to: string, webOrigin: string): AuthEmail {
  return {
    kind: "auth.alert",
    to,
    subject: "Sign-in to your VoiceDesk account was paused",
    text: `Someone entered the wrong password for your VoiceDesk account ${LOCK_AFTER_FAILURES} times, so we've paused sign-in for 15 minutes.\n\nIf this was you, wait 15 minutes and try again, or reset your password:\n${webOrigin}/forgot-password\n\nIf it wasn't you, your account is still safe. We recommend turning on two-step verification on your Account page.`,
  };
}

/**
 * Remembers the browser + OS family an account signed in from. Returns true when it's new
 * for an account that has signed in before (the very first sign-in isn't "new").
 */
export async function noteDevice(
  db: Database,
  userId: string,
  userAgent: string | undefined,
): Promise<boolean> {
  const hash = createHash("sha256").update(deviceKey(userAgent)).digest("hex");
  const mine = eq(knownDevices.userId, userId);
  const [seen] = await db
    .select({ hash: knownDevices.deviceHash })
    .from(knownDevices)
    .where(and(mine, eq(knownDevices.deviceHash, hash)));
  if (seen) {
    await db
      .update(knownDevices)
      .set({ lastSeenAt: new Date() })
      .where(and(mine, eq(knownDevices.deviceHash, hash)));
    return false;
  }
  const [{ count }] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(knownDevices)
    .where(mine)) as [{ count: number }];
  await db.insert(knownDevices).values({ userId, deviceHash: hash }).onConflictDoNothing();
  return count > 0;
}

export function newDeviceEmail(
  to: string,
  userAgent: string | undefined,
  ip: string | null,
  webOrigin: string,
  when = new Date(),
): AuthEmail {
  const { browser, os } = describeDevice(userAgent);
  const device = [browser, os].filter(Boolean).join(" on ") || "an unknown device";
  return {
    kind: "auth.alert",
    to,
    subject: "New sign-in to your VoiceDesk account",
    text: `Your VoiceDesk account was just signed in from ${device}${ip ? ` (IP address ${ip})` : ""} at ${when.toUTCString()}.\n\nIf this was you, there's nothing to do.\n\nIf it wasn't you, reset your password now and sign out the other devices on your Account page:\n${webOrigin}/forgot-password`,
  };
}
