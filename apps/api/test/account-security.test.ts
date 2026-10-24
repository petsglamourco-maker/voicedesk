import { createHash } from "node:crypto";
import { account, auditLog, user, withPlatformAccess } from "@voicedesk/db";
import { hashPassword as scryptHash } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cookieFrom,
  createHarness,
  lastEmailTo,
  ORIGIN,
  PASSWORD,
  signUpVerified,
  type TestHarness,
} from "./harness";

/** Security audit batch 3: password storage, reset, change, sessions, breached passwords. */
let h: TestHarness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const json = (cookie?: string) => ({ origin: ORIGIN, ...(cookie ? { cookie } : {}) });

async function idOf(email: string) {
  const [row] = await h.db.select({ id: user.id }).from(user).where(eq(user.email, email));
  return row!.id;
}

async function storedHash(userId: string) {
  const [row] = await h.db
    .select({ hash: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")));
  return row!.hash!;
}

const signIn = (email: string, password: string) =>
  h.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: json(),
    payload: { email, password },
  });

const session = async (cookie: string) =>
  (
    await h.app.inject({ method: "GET", url: "/api/auth/get-session", headers: json(cookie) })
  ).json<{ session: { id: string } } | null>();

describe("password storage (audit M16)", () => {
  it("stores new passwords with Argon2id", async () => {
    const a = await signUpVerified(h, "Argon");
    expect(await storedHash(await idOf(a.email))).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it("still accepts old scrypt hashes and upgrades them at sign-in", async () => {
    const a = await signUpVerified(h, "Scrypt");
    const id = await idOf(a.email);
    await h.db
      .update(account)
      .set({ password: await scryptHash(PASSWORD) })
      .where(eq(account.userId, id));
    expect(await storedHash(id)).not.toMatch(/^\$argon2id/);
    expect((await signIn(a.email, PASSWORD)).statusCode).toBe(200);
    expect(await storedHash(id)).toMatch(/^\$argon2id/);
    expect((await signIn(a.email, PASSWORD)).statusCode).toBe(200);
    expect((await signIn(a.email, "wrong-password-xyz")).statusCode).toBe(401);
  });
});

describe("password reset (audit H5)", () => {
  it("emails a single-use link that signs out every device", async () => {
    const a = await signUpVerified(h, "Forgetful");
    const asked = await h.app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      headers: json(),
      payload: { email: a.email, redirectTo: "/reset-password" },
    });
    expect(asked.statusCode).toBe(200);
    const mail = lastEmailTo(h, a.email);
    expect(mail.kind).toBe("auth.reset");
    const link = new URL(/https?:\/\/\S+/.exec(mail.text)![0]);
    const opened = await h.app.inject({ method: "GET", url: link.pathname + link.search });
    const token = new URL(opened.headers.location!, ORIGIN).searchParams.get("token")!;
    expect(token).toBeTruthy();

    const reset = (newPassword: string) =>
      h.app.inject({
        method: "POST",
        url: "/api/auth/reset-password",
        headers: json(),
        payload: { token, newPassword },
      });
    expect((await reset("a-brand-new-password-1")).statusCode).toBe(200);
    expect(await session(a.cookie)).toBeNull(); // the old session is gone
    expect((await signIn(a.email, PASSWORD)).statusCode).toBe(401);
    expect((await signIn(a.email, "a-brand-new-password-1")).statusCode).toBe(200);
    expect((await reset("another-password-2")).statusCode).toBe(400); // used once only
  });

  it("answers the same for unknown emails (no account probing)", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      headers: json(),
      payload: { email: "nobody-here@example.com", redirectTo: "/reset-password" },
    });
    expect(res.statusCode).toBe(200);
    expect(h.outbox.some((m) => m.to === "nobody-here@example.com")).toBe(false);
  });
});

describe("change password and sessions (audit H5)", () => {
  it("changing the password can sign out other devices", async () => {
    const a = await signUpVerified(h, "Changer");
    const other = cookieFrom(await signIn(a.email, PASSWORD));
    expect(await session(other)).not.toBeNull();
    const changed = await h.app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: json(a.cookie),
      payload: {
        currentPassword: PASSWORD,
        newPassword: "changed-password-123",
        revokeOtherSessions: true,
      },
    });
    expect(changed.statusCode).toBe(200);
    expect(await session(other)).toBeNull();
    const id = await idOf(a.email);
    const rows = await withPlatformAccess(h.db, { actorUserId: id, reason: "test" }, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "auth.password_changed"), eq(auditLog.targetId, id))),
    );
    expect(rows).toHaveLength(1);
  });

  it("lists sessions and signs one out", async () => {
    const a = await signUpVerified(h, "Sessions");
    const laptop = cookieFrom(await signIn(a.email, PASSWORD));
    const list = await h.app.inject({
      method: "GET",
      url: "/api/auth/list-sessions",
      headers: json(a.cookie),
    });
    const sessions = list.json<Array<{ id: string; token: string }>>();
    expect(sessions).toHaveLength(2);
    const laptopId = (await session(laptop))!.session.id;
    const target = sessions.find((s) => s.id === laptopId)!;
    const revoked = await h.app.inject({
      method: "POST",
      url: "/api/auth/revoke-session",
      headers: json(a.cookie),
      payload: { token: target.token },
    });
    expect(revoked.statusCode).toBe(200);
    expect(await session(laptop)).toBeNull();
    expect(await session(a.cookie)).not.toBeNull();
  });
});

describe("breached passwords (audit H5)", () => {
  it("refuses a password that appears in Have I Been Pwned", async () => {
    const hb = await createHarness({ breachCheck: true });
    const breached = "password-from-a-breach";
    const sha1 = createHash("sha1").update(breached).digest("hex").toUpperCase();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      expect(url).toBe(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`);
      return Promise.resolve(new Response(`${sha1.slice(5)}:42\r\nABCDEF0123:1`));
    });
    try {
      const res = await hb.app.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        headers: json(),
        payload: { name: "Pwned", email: `pwned-${Date.now()}@example.com`, password: breached },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ code: string }>().code).toBe("PASSWORD_COMPROMISED");
      expect(fetchSpy).toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      await hb.close();
    }
  });
});
