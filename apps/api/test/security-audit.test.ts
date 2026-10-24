import { auditLog, tenants, user, withPlatformAccess } from "@voicedesk/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHarness,
  createOwnerWithTenant,
  lastEmailTo,
  ORIGIN,
  signUpVerified,
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
    await h.db
      .update(user)
      .set({ isPlatformOwner: true, twoFactorEnabled: true })
      .where(eq(user.email, p.email));
    const list = await h.app.inject({
      method: "GET",
      url: "/api/platform/ai-providers",
      headers: as(p.cookie),
    });
    const provider = list.json<{ providers: Array<{ id: string; key: string }> }>().providers.find(
      (x) => x.key === "local",
    )!;
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
    expect(rows.at(-1)).toMatchObject({
      actorUserId: await userId(p.email),
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
