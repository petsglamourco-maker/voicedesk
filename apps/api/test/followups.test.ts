import { MockEmbeddingProvider } from "@voicedesk/adapters";
import {
  createConversation,
  createDbAgentServices,
  loadAgentContext,
} from "@voicedesk/agent-brain";
import { agentSettings, auditLog, followUps, withTenant } from "@voicedesk/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHarness,
  createOwnerWithTenant,
  makePlatformOwner,
  ORIGIN,
  signUpVerified,
  type TestHarness,
} from "./harness";

let h: TestHarness;
let platform: { email: string; cookie: string };

beforeAll(async () => {
  h = await createHarness();
  platform = await signUpVerified(h, "FollowPlatform");
  await makePlatformOwner(h, platform);
});
afterAll(() => h.close());

const as = (cookie: string) => ({ cookie, origin: ORIGIN });

async function switchOn(tenantId: string) {
  await withTenant(h.db, tenantId, (tx) =>
    tx
      .insert(agentSettings)
      .values({ tenantId, followUps: true })
      .onConflictDoUpdate({ target: agentSettings.tenantId, set: { followUps: true } }),
  );
}

async function servicesFor(tenantId: string, channel: "voice" | "whatsapp" = "voice") {
  const ctx = await loadAgentContext(h.db, tenantId, channel === "voice" ? "voice" : "chat");
  const conv = await createConversation(h.db, ctx, {
    tenantId,
    channel,
    callerPhone: "+447700900123",
  });
  const services = createDbAgentServices(
    { db: h.db, embeddings: new MockEmbeddingProvider() },
    { tenantId, conversationId: conv.conversationId, businessName: "Follow Co" },
  );
  return { ctx, services, conversationId: conv.conversationId };
}

describe("scheduling a follow-up", () => {
  it("only with the setting on; once per conversation; audited", async () => {
    const biz = await createOwnerWithTenant(h, "Follow Co");
    const off = await servicesFor(biz.tenantId);
    expect(off.ctx.followUps).toBe(false);
    const input = {
      channel: "sms" as const,
      to: "07700 900123",
      name: "Sam",
      topic: "whitening",
      language: "en",
    };
    expect(await off.services.scheduleFollowUp!(input)).toEqual({ ok: false, reason: "off" });

    await switchOn(biz.tenantId);
    const on = await servicesFor(biz.tenantId);
    expect(on.ctx.followUps).toBe(true);
    const first = await on.services.scheduleFollowUp!(input);
    expect(first.ok).toBe(true);
    expect(await on.services.scheduleFollowUp!(input)).toEqual({ ok: false, reason: "exists" });
    const [row] = await withTenant(h.db, biz.tenantId, (tx) =>
      tx.select().from(followUps).where(eq(followUps.conversationId, on.conversationId)),
    );
    expect(row).toMatchObject({ channel: "sms", to: "+447700900123", status: "scheduled" });
    expect(row!.sendAt.getTime()).toBeGreaterThan(Date.now());
    const audits = await withTenant(h.db, biz.tenantId, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.tenantId, biz.tenantId),
            eq(auditLog.action, "conversation.follow_up_scheduled"),
          ),
        ),
    );
    expect(audits).toHaveLength(1);
    // Wrong addresses and WhatsApp outside a WhatsApp conversation are refused.
    const other = await servicesFor(biz.tenantId);
    expect(
      await other.services.scheduleFollowUp!({ ...input, channel: "email", to: "nope" }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(await other.services.scheduleFollowUp!({ ...input, channel: "whatsapp" })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("is a Growth and Pro feature", async () => {
    const biz = await createOwnerWithTenant(h, "Starter Follow Co");
    const plan = await h.app.inject({
      method: "PUT",
      url: `/api/platform/tenants/${biz.tenantId}/plan`,
      headers: as(platform.cookie),
      payload: { planId: "starter" },
    });
    expect(plan.statusCode).toBe(200);
    const current = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/agent`,
      headers: as(biz.cookie),
    });
    const res = await h.app.inject({
      method: "PUT",
      url: `/api/tenants/${biz.tenantId}/agent`,
      headers: as(biz.cookie),
      payload: { ...current.json<{ settings: object }>().settings, followUps: true },
    });
    expect(res.statusCode).toBe(402);
    // Even if switched on earlier, a plan without it schedules nothing.
    await switchOn(biz.tenantId);
    const s = await servicesFor(biz.tenantId);
    expect(s.ctx.followUps).toBe(false);
  });
});
