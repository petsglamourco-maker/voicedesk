import { auditLog, tenants, user, withPlatformAccess } from "@voicedesk/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { memoryFreshAuth, REAUTH_TTL_SECONDS } from "../src/lib/fresh-auth";
import {
  createHarness,
  createOwnerWithTenant,
  lastEmailTo,
  ORIGIN,
  signUpVerified,
  makePlatformOwner,
  reauth,
  type TestHarness,
} from "./harness";

/** Security audit batch 2: no one-request business deletion; actors and failures audited. */
let h: TestHarness;
let owner: Awaited<ReturnType<typeof createOwnerWithTenant>>;
let ownerId: string;

const as = (cookie: string) => ({ cookie, origin: ORIGIN });

async function userId(email: string) {
  const [row] = await h.db.select({ id: user.id }).from(user).where(eq(user.email, email));
  return row!.id;
}

async function auditRows(action: string, targetId?: string) {
  return withPlatformAccess(h.db, { actorUserId: ownerId, reason: "test" }, (tx) =>
    tx
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, action), ...(targetId ? [eq(auditLog.targetId, targetId)] : [])),
      ),
  );
}

beforeAll(async () => {
  h = await createHarness();
  owner = await createOwnerWithTenant(h, "Audit Co");
  ownerId = await userId(owner.email);
});
afterAll(() => h.close());

describe("business deletion (audit H1)", () => {
  it("can't be done with one Better Auth request", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/auth/organization/delete",
      headers: as(owner.cookie),
      payload: { organizationId: owner.tenantId },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    const [still] = await withPlatformAccess(h.db, { actorUserId: ownerId, reason: "test" }, (tx) =>
      tx.select().from(tenants).where(eq(tenants.id, owner.tenantId)),
    );
    expect(still).toBeDefined();
  });
});

describe("audit log (audit H6)", () => {
  it("records failed sign-ins by account id, never the email", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: ORIGIN },
      payload: { email: owner.email, password: "definitely-wrong-password" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    const rows = await auditRows("auth.login_failed", ownerId);
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(owner.email);
  });

  it("names who changed a member's role", async () => {
    const staff = await signUpVerified(h, "Staffer");
    await h.app.inject({
      method: "POST",
      url: "/api/auth/organization/invite-member",
      headers: as(owner.cookie),
      payload: { email: staff.email, role: "staff", organizationId: owner.tenantId },
    });
    const invitationId = /accept-invite\/([0-9a-f-]+)/.exec(lastEmailTo(h, staff.email).text)![1]!;
    const accepted = await h.app.inject({
      method: "POST",
      url: "/api/auth/organization/accept-invitation",
      headers: as(staff.cookie),
      payload: { invitationId },
    });
    const memberId = accepted.json<{ member: { id: string } }>().member.id;
    await reauth(h, owner.cookie);
    const changed = await h.app.inject({
      method: "POST",
      url: "/api/auth/organization/update-member-role",
      headers: as(owner.cookie),
      payload: { memberId, role: "admin", organizationId: owner.tenantId },
    });
    expect(changed.statusCode).toBe(200);
    const [row] = await auditRows("member.role_changed", memberId);
    expect(row).toMatchObject({ actorUserId: ownerId, metadata: { from: "staff", to: "admin" } });
  });

  it("records platform changes with field names but never key values", async () => {
    const p = await signUpVerified(h, "AuditPlatform");
    await makePlatformOwner(h, p);
    const list = await h.app.inject({
      method: "GET",
      url: "/api/platform/ai-providers",
      headers: as(p.cookie),
    });
    const provider = list
      .json<{ providers: Array<{ id: string; key: string }> }>()
      .providers.find((x) => x.key === "local")!;
    const secret = "sk-test-should-never-be-logged-123";
    const res = await h.app.inject({
      method: "PUT",
      url: `/api/platform/ai-providers/${provider.id}`,
      headers: as(p.cookie),
      payload: { apiKey: secret },
    });
    expect(res.statusCode).toBe(200);
    // The hook runs after the response is sent; give it a moment.
    await new Promise((r) => setTimeout(r, 200));
    const rows = await auditRows("platform.ai-providers.put", provider.id);
    const actorId = await userId(p.email);
    expect(rows.find((r) => r.actorUserId === actorId)).toMatchObject({
      metadata: { fields: ["apiKey"] },
    });
    expect(JSON.stringify(rows)).not.toContain(secret);
    // Leave the shared provider row as it was (other test files rely on it).
    await h.app.inject({
      method: "PUT",
      url: `/api/platform/ai-providers/${provider.id}`,
      headers: as(p.cookie),
      payload: { apiKey: "" },
    });
  });
});

describe("password check before sensitive actions (audit H6)", () => {
  it("platform changes need the password confirmed; reading doesn't", async () => {
    const p = await signUpVerified(h, "StepUpPlatform");
    // Platform owner with two-step login, but this session never confirmed the password
    // (e.g. a stolen cookie).
    await h.db
      .update(user)
      .set({ isPlatformOwner: true, twoFactorEnabled: true })
      .where(eq(user.email, p.email));
    const fresh = p.cookie;
    const read = await h.app.inject({
      method: "GET",
      url: "/api/platform/ai-providers",
      headers: as(fresh),
    });
    expect(read.statusCode).toBe(200);
    const provider = read
      .json<{ providers: Array<{ id: string; key: string }> }>()
      .providers.find((x) => x.key === "local")!;
    const change = () =>
      h.app.inject({
        method: "PUT",
        url: `/api/platform/ai-providers/${provider.id}`,
        headers: as(fresh),
        payload: { apiKey: "" },
      });
    const refused = await change();
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: "REAUTH_REQUIRED" });

    const wrong = await h.app.inject({
      method: "POST",
      url: "/api/me/reauth",
      headers: as(fresh),
      payload: { password: "not-my-password" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(await auditRows("auth.reauth_failed")).not.toHaveLength(0);
    expect((await change()).statusCode).toBe(403);

    await reauth(h, fresh);
    expect((await change()).statusCode).toBe(200);
  });

  it("role changes and removals need it; inviting staff doesn't", async () => {
    const biz = await createOwnerWithTenant(h, "StepUp Co");
    const staff = await signUpVerified(h, "StepUpStaff");
    const invite = await h.app.inject({
      method: "POST",
      url: "/api/auth/organization/invite-member",
      headers: as(biz.cookie),
      payload: { email: staff.email, role: "staff", organizationId: biz.tenantId },
    });
    expect(invite.statusCode).toBe(200);
    const inviteAdmin = await h.app.inject({
      method: "POST",
      url: "/api/auth/organization/invite-member",
      headers: as(biz.cookie),
      payload: { email: "new-admin@example.com", role: "admin", organizationId: biz.tenantId },
    });
    expect(inviteAdmin.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
    const invitationId = /accept-invite\/([0-9a-f-]+)/.exec(lastEmailTo(h, staff.email).text)![1]!;
    const accepted = await h.app.inject({
      method: "POST",
      url: "/api/auth/organization/accept-invitation",
      headers: as(staff.cookie),
      payload: { invitationId },
    });
    const memberId = accepted.json<{ member: { id: string } }>().member.id;
    for (const [url, payload] of [
      ["update-member-role", { memberId, role: "admin", organizationId: biz.tenantId }],
      ["remove-member", { memberIdOrEmail: memberId, organizationId: biz.tenantId }],
    ] as const) {
      const res = await h.app.inject({
        method: "POST",
        url: `/api/auth/organization/${url}`,
        headers: as(biz.cookie),
        payload,
      });
      expect(res.statusCode, url).toBe(403);
    }
  });

  it("a confirmation lasts five minutes", async () => {
    let now = 0;
    const store = memoryFreshAuth(() => now);
    await store.mark("s1");
    expect(await store.isFresh("s1")).toBe(true);
    expect(await store.isFresh("s2")).toBe(false);
    now = REAUTH_TTL_SECONDS * 1000 + 1;
    expect(await store.isFresh("s1")).toBe(false);
  });
});
