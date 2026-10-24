import { auditLog, user, withPlatformAccess } from "@voicedesk/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rateLimitKey } from "../src/app";
import { LOCK_AFTER_FAILURES } from "../src/lib/sign-in-guard";
import { createHarness, ORIGIN, PASSWORD, signUpVerified, type TestHarness } from "./harness";

/** Security audit H4: lockout, new-device alerts, trusted proxies, request limits. */
let h: TestHarness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const FIREFOX_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:130.0) Gecko/20100101 Firefox/130.0";

function signIn(
  harness: TestHarness,
  email: string,
  password: string,
  extra: { userAgent?: string; remoteAddress?: string; forwardedFor?: string } = {},
) {
  return harness.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: {
      origin: ORIGIN,
      "user-agent": extra.userAgent ?? CHROME_WINDOWS,
      ...(extra.forwardedFor ? { "x-forwarded-for": extra.forwardedFor } : {}),
    },
    ...(extra.remoteAddress ? { remoteAddress: extra.remoteAddress } : {}),
    payload: { email, password },
  });
}

async function idOf(email: string) {
  const [row] = await h.db.select({ id: user.id }).from(user).where(eq(user.email, email));
  return row!.id;
}

async function audits(action: string, targetId: string) {
  return withPlatformAccess(h.db, { actorUserId: targetId, reason: "test" }, (tx) =>
    tx
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId))),
  );
}

const emailsTo = (email: string, subject: RegExp) =>
  h.outbox.filter((m) => m.to === email && subject.test(m.subject));

describe("account lockout", () => {
  it(`pauses sign-in after ${LOCK_AFTER_FAILURES} wrong passwords and emails the owner`, async () => {
    const a = await signUpVerified(h, "Locked");
    for (let i = 0; i < LOCK_AFTER_FAILURES; i++) {
      expect((await signIn(h, a.email, `wrong-password-${i}`)).statusCode).toBe(401);
    }
    const blocked = await signIn(h, a.email, PASSWORD);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ code: "ACCOUNT_LOCKED" });
    expect(emailsTo(a.email, /paused/)).toHaveLength(1);
    const id = await idOf(a.email);
    expect(await audits("auth.account_locked", id)).toHaveLength(1);
    expect((await audits("auth.login_blocked", id)).length).toBeGreaterThan(0);

    // Other accounts aren't affected.
    const b = await signUpVerified(h, "NotLocked");
    expect((await signIn(h, b.email, PASSWORD)).statusCode).toBe(200);
  });

  it("a successful sign-in clears earlier wrong passwords", async () => {
    const a = await signUpVerified(h, "Clears");
    for (let i = 0; i < LOCK_AFTER_FAILURES - 1; i++) await signIn(h, a.email, `nope-${i}-xxxx`);
    expect((await signIn(h, a.email, PASSWORD)).statusCode).toBe(200);
    for (let i = 0; i < LOCK_AFTER_FAILURES - 1; i++) await signIn(h, a.email, `nope-${i}-yyyy`);
    expect((await signIn(h, a.email, PASSWORD)).statusCode).toBe(200);
  });
});

describe("new-device alerts", () => {
  it("emails once when a known account signs in from a new browser or system", async () => {
    const a = await signUpVerified(h, "Devices");
    expect((await signIn(h, a.email, PASSWORD)).statusCode).toBe(200);
    expect(emailsTo(a.email, /New sign-in/)).toHaveLength(0); // the first device isn't "new"
    await signIn(h, a.email, PASSWORD); // same device again
    expect(emailsTo(a.email, /New sign-in/)).toHaveLength(0);

    await signIn(h, a.email, PASSWORD, { userAgent: FIREFOX_MAC });
    const alerts = emailsTo(a.email, /New sign-in/);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.text).toContain("Firefox on macOS");
    await signIn(h, a.email, PASSWORD, { userAgent: FIREFOX_MAC });
    expect(emailsTo(a.email, /New sign-in/)).toHaveLength(1);
  });
});

describe("client IP", () => {
  it("ignores X-Forwarded-For from anyone but a trusted proxy", async () => {
    const a = await signUpVerified(h, "Spoof");
    const id = await idOf(a.email);
    await signIn(h, a.email, "wrong-password-spoof", {
      remoteAddress: "203.0.113.9",
      forwardedFor: "198.51.100.1",
    });
    await signIn(h, a.email, "wrong-password-proxied", {
      remoteAddress: "127.0.0.1",
      forwardedFor: "198.51.100.2",
    });
    const ips = (await audits("auth.login_failed", id)).map((r) => r.ipAddress).sort();
    expect(ips).toEqual(["198.51.100.2", "203.0.113.9"]);
  });

  it("counts signed-in traffic per session and the rest per IP", () => {
    const signedIn = rateLimitKey({
      headers: { cookie: "theme=dark; better-auth.session_token=abc.def" },
      ip: "203.0.113.9",
    });
    expect(signedIn).toMatch(/^s:[0-9a-f]{32}$/);
    expect(signedIn).not.toContain("abc");
    expect(rateLimitKey({ headers: {}, ip: "203.0.113.9" })).toBe("ip:203.0.113.9");
  });
});

describe("Better Auth request limits", () => {
  it("limits sign-in attempts per IP", async () => {
    const limited = await createHarness({ authRateLimit: true });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++) {
        const res = await signIn(limited, `nobody-${i}@example.com`, "whatever-password", {
          remoteAddress: "203.0.113.50",
        });
        statuses.push(res.statusCode);
      }
      expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
      expect(statuses[20]).toBe(429);
      // A different client isn't affected.
      const other = await signIn(limited, "nobody@example.com", "whatever-password", {
        remoteAddress: "203.0.113.51",
      });
      expect(other.statusCode).toBe(401);
    } finally {
      await limited.close();
    }
  });
});
