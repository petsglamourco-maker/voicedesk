import { channelThreads, user, withTenant } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHarness,
  createOwnerWithTenant,
  ORIGIN,
  signUpVerified,
  type TestHarness,
} from "./harness";

let h: TestHarness;
let platform: { email: string; cookie: string };
let bizA: Awaited<ReturnType<typeof createOwnerWithTenant>>;
let bizB: Awaited<ReturnType<typeof createOwnerWithTenant>>;
let va: { email: string; cookie: string };

beforeAll(async () => {
  h = await createHarness();
  platform = await signUpVerified(h, "Platform");
  await h.db.update(user).set({ isPlatformOwner: true }).where(eq(user.email, platform.email));
  bizA = await createOwnerWithTenant(h, "VA Biz A");
  bizB = await createOwnerWithTenant(h, "VA Biz B");
  va = await signUpVerified(h, "Vicky");
});
afterAll(() => h.close());

const as = (who: { cookie: string }) => ({ cookie: who.cookie, origin: ORIGIN });

async function userId(email: string) {
  const [row] = await h.db.select({ id: user.id }).from(user).where(eq(user.email, email));
  return row!.id;
}

describe("VA console", () => {
  it("platform admin assigns a VA to two businesses; the VA sees both and their queue", async () => {
    for (const tenantId of [bizA.tenantId, bizB.tenantId]) {
      const res = await h.app.inject({
        method: "POST",
        url: "/api/platform/vas",
        headers: as(platform),
        payload: { email: va.email, tenantId },
      });
      expect(res.statusCode).toBe(201);
    }
    const list = await h.app.inject({
      method: "GET",
      url: "/api/platform/vas",
      headers: as(platform),
    });
    expect(list.json<{ assignments: unknown[] }>().assignments.length).toBeGreaterThanOrEqual(2);

    // Not available for anyone else: business owners can't use platform routes.
    const forbidden = await h.app.inject({
      method: "GET",
      url: "/api/platform/vas",
      headers: as(bizA),
    });
    expect(forbidden.statusCode).toBe(404);

    const me = await h.app.inject({ method: "GET", url: "/api/va/me", headers: as(va) });
    expect(me.json()).toMatchObject({
      presence: "offline",
      businesses: expect.arrayContaining([
        expect.objectContaining({ tenantId: bizA.tenantId, source: "platform" }),
        expect.objectContaining({ tenantId: bizB.tenantId, source: "platform" }),
      ]) as unknown,
    });

    const presence = await h.app.inject({
      method: "PUT",
      url: "/api/va/presence",
      headers: as(va),
      payload: { status: "available" },
    });
    expect(presence.json()).toEqual({ presence: "available" });

    // A chat waiting for a person in business B shows up with the business name.
    await withTenant(h.db, bizB.tenantId, (tx) =>
      tx.insert(channelThreads).values({
        tenantId: bizB.tenantId,
        channel: "whatsapp",
        externalId: "+447700900111",
        displayName: "Pat",
        needsHuman: true,
      }),
    );
    const queue = await h.app.inject({ method: "GET", url: "/api/va/queue", headers: as(va) });
    expect(queue.json<{ chats: unknown[] }>().chats).toEqual([
      expect.objectContaining({ businessName: "VA Biz B", name: "Pat", channel: "whatsapp" }),
    ]);
  });

  it("someone who answers for no business can't go available", async () => {
    const nobody = await signUpVerified(h, "Nobody");
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/va/presence",
      headers: as(nobody),
      payload: { status: "available" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("owners let their own members answer calls, but can't remove a platform VA", async () => {
    const vaId = await userId(va.email);
    const off = await h.app.inject({
      method: "PUT",
      url: `/api/tenants/${bizA.tenantId}/answerers/${vaId}`,
      headers: as(bizA),
      payload: { on: false },
    });
    expect(off.json<{ answerers: unknown[] }>().answerers).toContainEqual({
      userId: vaId,
      source: "platform",
    });
    const ownerId = await userId(bizA.email);
    const on = await h.app.inject({
      method: "PUT",
      url: `/api/tenants/${bizA.tenantId}/answerers/${ownerId}`,
      headers: as(bizA),
      payload: { on: true },
    });
    expect(on.json<{ answerers: unknown[] }>().answerers).toContainEqual({
      userId: ownerId,
      source: "business",
    });
    // Business B's owner can't touch business A.
    const other = await h.app.inject({
      method: "PUT",
      url: `/api/tenants/${bizA.tenantId}/answerers/${ownerId}`,
      headers: as(bizB),
      payload: { on: false },
    });
    expect(other.statusCode).toBe(404);
  });

  it("removing the VA ends their access to that business", async () => {
    const vaId = await userId(va.email);
    const res = await h.app.inject({
      method: "DELETE",
      url: `/api/platform/vas/${bizA.tenantId}/${vaId}`,
      headers: as(platform),
    });
    expect(res.statusCode).toBe(204);
    const inbox = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${bizA.tenantId}/inbox`,
      headers: as(va),
    });
    expect(inbox.statusCode).toBe(404);
  });
});

describe("display name", () => {
  it("people can change the name callers hear", async () => {
    const person = await signUpVerified(h, "Renamed");
    const res = await h.app.inject({
      method: "POST",
      url: "/api/auth/update-user",
      headers: as(person),
      payload: { name: "Grace Hopper" },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await h.db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.email, person.email));
    expect(row?.name).toBe("Grace Hopper");
    const me = await h.app.inject({ method: "GET", url: "/api/me", headers: as(person) });
    expect(me.json()).toMatchObject({ user: { name: "Grace Hopper" } });
  });
});
