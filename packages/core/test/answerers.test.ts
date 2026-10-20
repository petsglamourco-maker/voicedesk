import { randomUUID } from "node:crypto";
import { closeDb, member, user } from "@voicedesk/db";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AnswererError,
  answererTenants,
  assignVa,
  availableAnswerers,
  getPresence,
  listAnswerers,
  PRESENCE_TTL_MS,
  removeVa,
  setAnswersCalls,
  setPresence,
} from "../src/answerers";
import { getMembershipRole } from "../src/tenants";

let dbs: TestDbs;
let admin: string;

async function createUser(): Promise<{ id: string; email: string }> {
  const email = `${randomUUID()}@example.com`;
  const [row] = await dbs.app
    .insert(user)
    .values({ name: "Test User", email })
    .returning({ id: user.id });
  return { id: row!.id, email };
}

beforeAll(async () => {
  dbs = connectTestDbs();
  admin = (await createUser()).id;
});
afterAll(async () => {
  await closeDb(dbs.app);
  await closeDb(dbs.owner);
});

describe("VAs across businesses", () => {
  it("assigning a VA makes them staff of each business; removing undoes only that", async () => {
    const [a, b] = [await createTestTenant(dbs.app, "A"), await createTestTenant(dbs.app, "B")];
    const va = await createUser();
    await assignVa(dbs.app, admin, { email: va.email, tenantId: a });
    await assignVa(dbs.app, admin, { email: va.email.toUpperCase(), tenantId: b });
    expect(await getMembershipRole(dbs.app, va.id, a)).toBe("staff");
    expect((await answererTenants(dbs.app, va.id)).map((t) => t.tenantId).sort()).toEqual(
      [a, b].sort(),
    );

    await removeVa(dbs.app, admin, { tenantId: a, userId: va.id });
    expect(await getMembershipRole(dbs.app, va.id, a)).toBeNull();
    expect((await answererTenants(dbs.app, va.id)).map((t) => t.tenantId)).toEqual([b]);
  });

  it("keeps an existing membership when a member is also made a VA", async () => {
    const tenant = await createTestTenant(dbs.app);
    const person = await createUser();
    await dbs.app
      .insert(member)
      .values({ organizationId: tenant, userId: person.id, role: "admin", createdAt: new Date() });
    await assignVa(dbs.app, admin, { email: person.email, tenantId: tenant });
    await removeVa(dbs.app, admin, { tenantId: tenant, userId: person.id });
    expect(await getMembershipRole(dbs.app, person.id, tenant)).toBe("admin");
  });

  it("needs an existing account", async () => {
    const tenant = await createTestTenant(dbs.app);
    await expect(
      assignVa(dbs.app, admin, { email: "nobody@example.com", tenantId: tenant }),
    ).rejects.toBeInstanceOf(AnswererError);
  });
});

describe("business members who answer calls", () => {
  it("members opt in and out; non-members can't", async () => {
    const tenant = await createTestTenant(dbs.app);
    const staff = await createUser();
    await dbs.app
      .insert(member)
      .values({ organizationId: tenant, userId: staff.id, role: "staff", createdAt: new Date() });
    await setAnswersCalls(dbs.app, tenant, admin, staff.id, true);
    expect(await listAnswerers(dbs.app, tenant)).toEqual([
      { userId: staff.id, source: "business" },
    ]);
    await setAnswersCalls(dbs.app, tenant, admin, staff.id, false);
    expect(await listAnswerers(dbs.app, tenant)).toEqual([]);

    const outsider = await createUser();
    await expect(setAnswersCalls(dbs.app, tenant, admin, outsider.id, true)).rejects.toBeInstanceOf(
      AnswererError,
    );
  });

  it("turning off a member's toggle never removes a platform VA", async () => {
    const tenant = await createTestTenant(dbs.app);
    const va = await createUser();
    await assignVa(dbs.app, admin, { email: va.email, tenantId: tenant });
    await setAnswersCalls(dbs.app, tenant, admin, va.id, false);
    expect(await listAnswerers(dbs.app, tenant)).toEqual([{ userId: va.id, source: "platform" }]);
    const [m] = await dbs.app
      .select()
      .from(member)
      .where(and(eq(member.organizationId, tenant), eq(member.userId, va.id)));
    expect(m).toBeDefined();
  });
});

describe("presence", () => {
  it("only available people with a fresh heartbeat can take calls", async () => {
    const tenant = await createTestTenant(dbs.app);
    const [p1, p2, p3] = [await createUser(), await createUser(), await createUser()];
    for (const p of [p1, p2, p3])
      await assignVa(dbs.app, admin, { email: p.email, tenantId: tenant });
    const now = new Date();
    await setPresence(dbs.app, p1.id, "available", now);
    await setPresence(dbs.app, p2.id, "away", now);
    await setPresence(dbs.app, p3.id, "available", new Date(now.getTime() - PRESENCE_TTL_MS - 1));

    expect(await availableAnswerers(dbs.app, tenant, now)).toEqual([p1.id]);
    expect(await getPresence(dbs.app, p3.id, now)).toBe("offline");
    expect(await getPresence(dbs.app, p2.id, now)).toBe("away");
  });
});
