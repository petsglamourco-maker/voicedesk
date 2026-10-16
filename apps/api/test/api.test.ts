import { randomUUID } from "node:crypto";
import type { AuthEmail } from "@voicedesk/auth";
import { loadRootEnv, requireEnv } from "@voicedesk/config/load-env";
import { closeDb, createDb, type Database } from "@voicedesk/db";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createAppAuth } from "../src/container";
import { parseEnv } from "../src/env";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct-horse-battery";

let app: FastifyInstance;
let db: Database;
const outbox: AuthEmail[] = [];

function cookieFrom(res: LightMyRequestResponse): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c) => c.split(";")[0]).join("; ");
}

function lastEmailTo(email: string): AuthEmail {
  const found = outbox.findLast((m) => m.to === email);
  if (!found) throw new Error(`no email sent to ${email}`);
  return found;
}

/** Signs up, follows the emailed verification link, and returns the session cookie. */
async function signUpVerified(name: string): Promise<{ email: string; cookie: string }> {
  const email = `${name.toLowerCase()}-${randomUUID()}@example.com`;
  const signUp = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: ORIGIN },
    payload: { name, email, password: PASSWORD },
  });
  expect(signUp.statusCode).toBe(200);
  expect(cookieFrom(signUp)).not.toContain("session_token"); // must verify first

  const link = /https?:\/\/\S+/.exec(lastEmailTo(email).text)![0];
  const verify = await app.inject({
    method: "GET",
    url: new URL(link).pathname + new URL(link).search,
    headers: { origin: ORIGIN },
  });
  expect(verify.statusCode).toBeLessThan(400);
  const cookie = cookieFrom(verify);
  expect(cookie).toContain("session_token");
  return { email, cookie };
}

beforeAll(async () => {
  loadRootEnv();
  const env = parseEnv({
    ...process.env,
    DATABASE_URL: requireEnv("TEST_DATABASE_URL"),
    LOG_LEVEL: "silent",
  });
  db = createDb(env.DATABASE_URL);
  const auth = createAppAuth(env, db, (email) => {
    outbox.push(email);
    return Promise.resolve();
  });
  app = await buildApp({ db, auth, checkRedis: () => Promise.resolve(true), logLevel: "silent" });
});

afterAll(async () => {
  await app.close();
  await closeDb(db);
});

describe("system", () => {
  it("reports health", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.json()).toEqual({ status: "ok", database: true, redis: true });
  });

  it("serves the OpenAPI document", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/json" });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json<{ paths: object }>().paths)).toContain("/api/tenants");
  });

  it("requires a session", async () => {
    expect((await app.inject({ method: "GET", url: "/api/me" })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "POST", url: "/api/tenants", payload: {} })).statusCode,
    ).toBeOneOf([400, 401]);
  });
});

describe("sign up → create business → invite staff", () => {
  it("works end to end with tenant isolation and role-based access", async () => {
    const owner = await signUpVerified("Owner");
    const outsider = await signUpVerified("Outsider");

    // Validation
    const bad = await app.inject({
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
    const created = await app.inject({
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

    const asOwner = await app.inject({
      method: "GET",
      url: `/api/tenants/${tenantId}`,
      headers: { cookie: owner.cookie },
    });
    expect(asOwner.json()).toMatchObject({ role: "owner", tenant: { name: "Bright Dental" } });

    // An outsider cannot see it — and can't tell it exists.
    const asOutsider = await app.inject({
      method: "GET",
      url: `/api/tenants/${tenantId}`,
      headers: { cookie: outsider.cookie },
    });
    expect(asOutsider.statusCode).toBe(404);

    // Invite a staff member
    const staff = await signUpVerified("Staff");
    const invite = await app.inject({
      method: "POST",
      url: "/api/auth/organization/invite-member",
      headers: { cookie: owner.cookie, origin: ORIGIN },
      payload: { email: staff.email, role: "staff", organizationId: tenantId },
    });
    expect(invite.statusCode).toBe(200);
    const invitationId = /accept-invite\/([0-9a-f-]{36})/.exec(lastEmailTo(staff.email).text)![1];

    // The outsider can't accept someone else's invitation.
    const hijack = await app.inject({
      method: "POST",
      url: "/api/auth/organization/accept-invitation",
      headers: { cookie: outsider.cookie, origin: ORIGIN },
      payload: { invitationId },
    });
    expect(hijack.statusCode).toBeGreaterThanOrEqual(400);

    const accept = await app.inject({
      method: "POST",
      url: "/api/auth/organization/accept-invitation",
      headers: { cookie: staff.cookie, origin: ORIGIN },
      payload: { invitationId },
    });
    expect(accept.statusCode).toBe(200);

    const asStaff = await app.inject({
      method: "GET",
      url: `/api/tenants/${tenantId}`,
      headers: { cookie: staff.cookie },
    });
    expect(asStaff.json()).toMatchObject({ role: "staff" });

    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: staff.cookie },
    });
    expect(me.json<{ tenants: Array<{ tenantId: string }> }>().tenants).toEqual([
      expect.objectContaining({ tenantId, role: "staff" }),
    ]);

    // Staff can't read the audit log; the owner can, and it recorded each step.
    const staffAudit = await app.inject({
      method: "GET",
      url: `/api/tenants/${tenantId}/audit`,
      headers: { cookie: staff.cookie },
    });
    expect(staffAudit.statusCode).toBe(403);

    const ownerAudit = await app.inject({
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
