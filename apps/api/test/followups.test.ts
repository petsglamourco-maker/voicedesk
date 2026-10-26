import { MockEmbeddingProvider } from "@voicedesk/adapters";
import {
  claimDueFollowUps,
  createConversation,
  createDbAgentServices,
  finishFollowUp,
  followUpCounts,
  loadAgentContext,
  planFollowUp,
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

  it("sends when due with the one-off wording, skips after a booking, credits bookings", async () => {
    const biz = await createOwnerWithTenant(h, "Send Co");
    await switchOn(biz.tenantId);
    const a = await servicesFor(biz.tenantId);
    await a.services.scheduleFollowUp!({
      channel: "sms",
      to: "07700 900111",
      name: "Sam",
      topic: "teeth whitening",
      language: "en",
    });
    const b = await servicesFor(biz.tenantId);
    await b.services.scheduleFollowUp!({
      channel: "email",
      to: "pat@example.com",
      name: null,
      topic: "veneers",
      language: "es",
    });
    // Pat books before the follow-up goes out: theirs is skipped.
    await b.services.createBooking({
      service: "Check-up",
      startsAt: new Date(Date.now() + 3 * 86_400_000),
      endsAt: new Date(Date.now() + 3 * 86_400_000 + 1_800_000),
      customerName: "Pat",
      customerPhone: "+447700900999",
      customerEmail: "pat@example.com",
      notes: null,
    });

    // Not due yet.
    expect(await claimDueFollowUps(h.db, new Date(), [biz.tenantId])).toEqual([]);
    const later = new Date(Date.now() + 3 * 86_400_000);
    const due = await claimDueFollowUps(h.db, later, [biz.tenantId]);
    expect(due).toHaveLength(2);
    // Claimed once: a second worker gets nothing.
    expect(await claimDueFollowUps(h.db, later, [biz.tenantId])).toEqual([]);

    const sam = due.find((r) => r.to === "+447700900111")!;
    const pat = due.find((r) => r.to === "pat@example.com")!;
    const samPlan = await planFollowUp(h.db, sam, later);
    expect("plan" in samPlan).toBe(true);
    if ("plan" in samPlan) {
      expect(samPlan.plan.messages[0]).toMatchObject({ channel: "sms", to: "+447700900111" });
      expect(samPlan.plan.messages[0]!.text).toContain("Hi Sam, it's Send Co");
      expect(samPlan.plan.messages[0]!.text).toContain("teeth whitening");
      expect(samPlan.plan.messages[0]!.text).toContain("This is a one-off message.");
    }
    expect(await planFollowUp(h.db, pat, later)).toEqual({ skip: "booked" });
    await finishFollowUp(h.db, sam, { status: "sent" }, later);
    await finishFollowUp(h.db, pat, { status: "skipped", reason: "booked" }, later);

    // Sam books two days later: the follow-up gets the credit.
    const c = await servicesFor(biz.tenantId);
    await c.services.createBooking({
      service: "Whitening",
      startsAt: new Date(Date.now() + 5 * 86_400_000),
      endsAt: new Date(Date.now() + 5 * 86_400_000 + 1_800_000),
      customerName: "Sam",
      customerPhone: "+447700900111",
      customerEmail: null,
      notes: null,
    });
    const counts = await followUpCounts(h.db, biz.tenantId, new Date(Date.now() - 86_400_000));
    expect(counts).toEqual({ sent: 1, booked: 1, scheduled: 0 });
  });

  it("WhatsApp follow-ups are skipped once Meta's 24-hour window has passed", async () => {
    const biz = await createOwnerWithTenant(h, "WA Follow Co");
    await switchOn(biz.tenantId);
    const wa = await servicesFor(biz.tenantId, "whatsapp");
    const ok = await wa.services.scheduleFollowUp!({
      channel: "whatsapp",
      to: "+447700900222",
      name: null,
      topic: "prices",
      language: "en",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.sendAt.getTime() - Date.now()).toBeLessThanOrEqual(23 * 3_600_000 + 1000);
    const late = new Date(Date.now() + 2 * 86_400_000);
    const [row] = await claimDueFollowUps(h.db, late, [biz.tenantId]);
    expect(await planFollowUp(h.db, row!, late)).toEqual({ skip: "whatsapp_window" });
  });
});
