import { MockLlmProvider } from "@voicedesk/adapters";
import { getPlanState } from "@voicedesk/core";
import {
  closeDb,
  demoRequests,
  knowledgeDocuments,
  knowledgeSources,
  organization,
  tenants,
  withPlatformAccess,
  withTenant,
} from "@voicedesk/db";
import { connectTestDbs, type TestDbs } from "@voicedesk/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildDemoProfile,
  createDemo,
  DEMO_CHAT_TURNS,
  demoSuggestions,
  findDemo,
  isDemoTenant,
  purgeExpiredDemos,
  useDemoAllowance,
} from "../src/demo";
import { emptyProfile } from "../src/profile";
import { getApprovedProfile } from "../src/profile-store";
import { checkSend } from "../src/send-guard";
import { DEFAULT_PLATFORM_SPEND_SETTINGS } from "@voicedesk/db";
import { PROFILE } from "./fixtures";

let dbs: TestDbs;
beforeAll(() => {
  dbs = connectTestDbs();
});
afterAll(async () => {
  await closeDb(dbs.app);
  await closeDb(dbs.owner);
});

const demo = (email: string | null = null, now = new Date()) =>
  createDemo(dbs.app, {
    website: "https://glow-studio.test/",
    businessName: "Glow Studio",
    email,
    ipHash: "abc",
    now,
  });

async function withPage(tenantId: string) {
  const [source] = await withTenant(dbs.app, tenantId, (tx) =>
    tx.select().from(knowledgeSources).where(eq(knowledgeSources.tenantId, tenantId)),
  );
  await withTenant(dbs.app, tenantId, (tx) =>
    tx.insert(knowledgeDocuments).values({
      tenantId,
      sourceId: source!.id,
      url: "https://glow-studio.test/",
      title: "Glow Studio",
      contentHash: "h",
      text: "Glow Studio. Cut and blow-dry £45. Open Mon–Fri 9–6.",
    }),
  );
}

describe("instant demos (ADR 0029)", () => {
  it("is a business with no members on the demo plan, found only with its key", async () => {
    const d = await demo();
    expect(await isDemoTenant(dbs.app, d.tenantId)).toBe(true);
    const plan = await getPlanState(dbs.app, d.tenantId);
    expect(plan.plan).toMatchObject({ id: "demo", texts: 0, features: [] });
    expect((await findDemo(dbs.app, d.key))?.status).toBe("crawling");
    expect(await findDemo(dbs.app, `${d.tenantId}.wrong`)).toBeNull();
    expect(await findDemo(dbs.app, "nonsense")).toBeNull();
    // Expired keys stop working.
    const later = new Date(Date.now() + 25 * 3600 * 1000);
    expect(await findDemo(dbs.app, d.key, later)).toBeNull();
  });

  it("can't send texts", async () => {
    const d = await demo();
    const decision = await checkSend(dbs.app, {
      tenantId: d.tenantId,
      kind: "sms",
      to: "+447700900123",
      settings: DEFAULT_PLATFORM_SPEND_SETTINGS,
    });
    expect(decision.ok).toBe(false);
  });

  it("builds and approves its profile from the site; failures end the demo", async () => {
    const d = await demo();
    await withPage(d.tenantId);
    const profile = { ...emptyProfile("Glow Studio"), services: PROFILE.services };
    const llm = new MockLlmProvider().enqueue(MockLlmProvider.text(JSON.stringify(profile)));
    expect(await buildDemoProfile({ db: dbs.app, llm }, d.tenantId)).toEqual({ ok: true });
    expect((await findDemo(dbs.app, d.key))?.status).toBe("ready");
    expect((await getApprovedProfile(dbs.app, d.tenantId))?.businessName).toBe("Glow Studio");
    expect(demoSuggestions(profile)).toEqual([
      "How much is check-up?",
      "Can I book check-up for next week?",
      "Where are you based?",
    ]);

    const empty = await demo();
    expect(
      await buildDemoProfile({ db: dbs.app, llm: new MockLlmProvider() }, empty.tenantId),
    ).toEqual({ ok: false });
    expect(await findDemo(dbs.app, empty.key)).toMatchObject({
      status: "failed",
      error: "no_pages",
    });
  });

  it("limits chat turns", async () => {
    const d = await demo();
    for (let i = 0; i < DEMO_CHAT_TURNS; i++) {
      expect(await useDemoAllowance(dbs.app, d.tenantId, "chat")).toBe(true);
    }
    expect(await useDemoAllowance(dbs.app, d.tenantId, "chat")).toBe(false);
    expect(await useDemoAllowance(dbs.app, d.tenantId, "voice")).toBe(true);
  });

  it("is deleted when it expires; the lead is kept for 90 days, then forgotten", async () => {
    const created = new Date(Date.now() - 30 * 3600 * 1000);
    const d = await demo("owner@glow-studio.test", created);
    const result = await purgeExpiredDemos(dbs.app, new Date(), [d.tenantId]);
    expect(result.purged).toBe(1);
    expect(
      await dbs.app.select().from(organization).where(eq(organization.id, d.tenantId)),
    ).toEqual([]);
    const [request] = await withPlatformAccess(
      dbs.app,
      { actorUserId: null, reason: "test" },
      (tx) => tx.select().from(demoRequests).where(eq(demoRequests.id, d.requestId)),
    );
    expect(request).toMatchObject({ tenantId: null, email: "owner@glow-studio.test" });
    expect(request?.purgedAt).toBeInstanceOf(Date);

    await purgeExpiredDemos(dbs.app, new Date(Date.now() + 91 * 24 * 3600 * 1000), []);
    const [forgotten] = await withPlatformAccess(
      dbs.app,
      { actorUserId: null, reason: "test" },
      (tx) => tx.select().from(demoRequests).where(eq(demoRequests.id, d.requestId)),
    );
    expect(forgotten?.email).toBeNull();
  });

  it("never deletes a real business", async () => {
    const d = await demo();
    // Even if a real business somehow had the same id in the list, only demo rows go.
    await withPlatformAccess(dbs.app, { actorUserId: null, reason: "test" }, (tx) =>
      tx.update(tenants).set({ demoExpiresAt: null }).where(eq(tenants.id, d.tenantId)),
    );
    const far = new Date(Date.now() + 48 * 3600 * 1000);
    expect((await purgeExpiredDemos(dbs.app, far, [d.tenantId])).purged).toBe(0);
    expect(
      await dbs.app.select().from(organization).where(eq(organization.id, d.tenantId)),
    ).toHaveLength(1);
  });
});
