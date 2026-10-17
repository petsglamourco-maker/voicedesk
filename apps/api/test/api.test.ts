import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, lastEmailTo, ORIGIN, signUpVerified, type TestHarness } from "./harness";

let h: TestHarness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(() => h.close());

describe("system", () => {
  it("reports health", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/health" });
    expect(res.json()).toEqual({ status: "ok", database: true, redis: true });
  });

  it("serves the OpenAPI document", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/docs/json" });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json<{ paths: object }>().paths)).toContain("/api/tenants");
  });

  it("requires a session", async () => {
    expect((await h.app.inject({ method: "GET", url: "/api/me" })).statusCode).toBe(401);
    expect(
      (await h.app.inject({ method: "POST", url: "/api/tenants", payload: {} })).statusCode,
    ).toBeOneOf([400, 401]);
  });
});

describe("sign up → create business → invite staff", () => {
  it("works end to end with tenant isolation and role-based access", async () => {
    const owner = await signUpVerified(h, "Owner");
    const outsider = await signUpVerified(h, "Outsider");

    // Validation
    const bad = await h.app.inject({
      method: "POST",
      url: "/api/tenants",
      headers: { cookie: owner.cookie, origin: ORIGIN },
      payload: {
        name: "X Co",
        countryCode: "ZZ",
        timezone: "Europe/London",
        defaultLanguage: "en",
      },
    });
    expect(bad.statusCode).toBe(400);

    // Create a business
    const created = await h.app.inject({
      method: "POST",
      url: "/api/tenants",
      headers: { cookie: owner.cookie, origin: ORIGIN },
      payload: {
        name: "Bright Dental",
        countryCode: "GB",
        timezone: "Europe/London",
        defaultLanguage: "en",
      },
    });
    expect(created.statusCode).toBe(201);
    const tenantId = created.json<{ id: string }>().id;

    const asOwner = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${tenantId}`,
      headers: { cookie: owner.cookie },
    });
    expect(asOwner.json()).toMatchObject({ role: "owner", tenant: { name: "Bright Dental" } });

    // An outsider cannot see it — and can't tell it exists.
    const asOutsider = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${tenantId}`,
      headers: { cookie: outsider.cookie },
    });
    expect(asOutsider.statusCode).toBe(404);

    // Invite a staff member
    const staff = await signUpVerified(h, "Staff");
    const invite = await h.app.inject({
      method: "POST",
      url: "/api/auth/organization/invite-member",
      headers: { cookie: owner.cookie, origin: ORIGIN },
      payload: { email: staff.email, role: "staff", organizationId: tenantId },
    });
    expect(invite.statusCode).toBe(200);
    const invitationId = /accept-invite\/([0-9a-f-]{36})/.exec(
      lastEmailTo(h, staff.email).text,
    )![1];

    // The outsider can't accept someone else's invitation.
    const hijack = await h.app.inject({
      method: "POST",
      url: "/api/auth/organization/accept-invitation",
      headers: { cookie: outsider.cookie, origin: ORIGIN },
      payload: { invitationId },
    });
    expect(hijack.statusCode).toBeGreaterThanOrEqual(400);

    const accept = await h.app.inject({
      method: "POST",
      url: "/api/auth/organization/accept-invitation",
      headers: { cookie: staff.cookie, origin: ORIGIN },
      payload: { invitationId },
    });
    expect(accept.statusCode).toBe(200);

    const asStaff = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${tenantId}`,
      headers: { cookie: staff.cookie },
    });
    expect(asStaff.json()).toMatchObject({ role: "staff" });

    const me = await h.app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: staff.cookie },
    });
    expect(me.json<{ tenants: Array<{ tenantId: string }> }>().tenants).toEqual([
      expect.objectContaining({ tenantId, role: "staff" }),
    ]);

    // Staff can't read the audit log; the owner can, and it recorded each step.
    const staffAudit = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${tenantId}/audit`,
      headers: { cookie: staff.cookie },
    });
    expect(staffAudit.statusCode).toBe(403);

    const ownerAudit = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${tenantId}/audit`,
      headers: { cookie: owner.cookie },
    });
    const actions = ownerAudit.json<Array<{ action: string }>>().map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(["tenant.created", "member.invited", "member.joined"]),
    );
  });
});
