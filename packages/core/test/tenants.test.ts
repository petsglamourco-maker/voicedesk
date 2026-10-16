import { randomUUID } from "node:crypto";
import { closeDb, member, organization, user, withTenant, auditLog } from "@voicedesk/db";
import { connectTestDbs, type TestDbs } from "@voicedesk/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createBusinessSchema,
  createTenantProfile,
  getMembershipRole,
  getTenant,
  listUserTenants,
} from "../src/tenants";

let dbs: TestDbs;

async function createUser(): Promise<string> {
  const [row] = await dbs.app
    .insert(user)
    .values({ name: "Test User", email: `${randomUUID()}@example.com` })
    .returning({ id: user.id });
  return row!.id;
}

async function createOrg(ownerId: string, name: string): Promise<string> {
  const id = randomUUID();
  await dbs.app.insert(organization).values({ id, name, slug: `org-${id}`, createdAt: new Date() });
  await dbs.app
    .insert(member)
    .values({ organizationId: id, userId: ownerId, role: "owner", createdAt: new Date() });
  return id;
}

beforeAll(() => {
  dbs = connectTestDbs();
});

afterAll(async () => {
  await closeDb(dbs.app);
  await closeDb(dbs.owner);
});

describe("createBusinessSchema", () => {
  const valid = {
    name: "Bright Dental",
    countryCode: "gb",
    timezone: "Europe/London",
    defaultLanguage: "en",
  };

  it("accepts and normalises valid input", () => {
    expect(createBusinessSchema.parse(valid)).toEqual({ ...valid, countryCode: "GB" });
  });

  it("rejects unsupported countries, bad time zones and languages", () => {
    expect(createBusinessSchema.safeParse({ ...valid, countryCode: "ZZ" }).success).toBe(false);
    expect(createBusinessSchema.safeParse({ ...valid, timezone: "Mars/Base" }).success).toBe(false);
    expect(createBusinessSchema.safeParse({ ...valid, defaultLanguage: "it" }).success).toBe(false);
    expect(createBusinessSchema.safeParse({ ...valid, name: " " }).success).toBe(false);
  });
});

describe("tenant profile", () => {
  it("creates a tenant with an audit entry, visible only within that tenant", async () => {
    const ownerId = await createUser();
    const tenantId = await createOrg(ownerId, "Bright Dental");
    const tenant = await createTenantProfile(dbs.app, {
      tenantId,
      actorUserId: ownerId,
      input: createBusinessSchema.parse({
        name: "Bright Dental",
        countryCode: "GB",
        timezone: "Europe/London",
        defaultLanguage: "en",
      }),
    });
    expect(tenant).toMatchObject({ id: tenantId, status: "onboarding", dataRegion: "uk" });
    expect((await getTenant(dbs.app, tenantId))?.name).toBe("Bright Dental");

    const audit = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.tenantId, tenantId)),
    );
    expect(audit.map((a) => a.action)).toEqual(["tenant.created"]);
  });
});

describe("membership", () => {
  it("resolves roles and lists only the user's businesses", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const aliceOrg = await createOrg(alice, "Alice Co");
    const bobOrg = await createOrg(bob, "Bob Co");
    await dbs.app
      .insert(member)
      .values({ organizationId: bobOrg, userId: alice, role: "staff", createdAt: new Date() });

    expect(await getMembershipRole(dbs.app, alice, aliceOrg)).toBe("owner");
    expect(await getMembershipRole(dbs.app, alice, bobOrg)).toBe("staff");
    expect(await getMembershipRole(dbs.app, bob, aliceOrg)).toBeNull();

    const bobTenants = await listUserTenants(dbs.app, bob);
    expect(bobTenants.map((t) => t.tenantId)).toEqual([bobOrg]);
  });
});
