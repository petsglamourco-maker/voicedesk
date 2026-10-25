import type { DEFAULT_CAPS } from "@voicedesk/agent-brain";
import {
  checkSend,
  createConversation,
  getPlatformSpendSettings,
  loadAgentContext,
  monthWindow,
  planSpendAlerts,
  recordSmsSpend,
  spendStatus,
} from "@voicedesk/agent-brain";
import { agentSettings, conversations, llmUsage, withTenant } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHarness,
  createOwnerWithTenant,
  lastEmailTo,
  makePlatformOwner,
  ORIGIN,
  reauth,
  signUpVerified,
  type TestHarness,
} from "./harness";

/** Security batch 4 (ADR 0022): spend tracking, caps, send guard, suspend. */
let h: TestHarness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const as = (cookie: string) => ({ cookie, origin: ORIGIN });

async function setCaps(tenantId: string, caps: Partial<typeof DEFAULT_CAPS>) {
  const set = {
    ...(caps.ai !== undefined ? { aiCapPence: caps.ai } : {}),
    ...(caps.sms !== undefined ? { smsCapPence: caps.sms } : {}),
    ...(caps.calls !== undefined ? { callsCapPence: caps.calls } : {}),
  };
  await withTenant(h.db, tenantId, (tx) =>
    tx
      .insert(agentSettings)
      .values({ tenantId, ...set })
      .onConflictDoUpdate({ target: agentSettings.tenantId, set }),
  );
}

async function addAiCost(tenantId: string, costUsd: number) {
  await withTenant(h.db, tenantId, (tx) =>
    tx.insert(llmUsage).values({
      tenantId,
      purpose: "conversation.turn",
      model: "test",
      inputTokens: 1,
      outputTokens: 1,
      costUsd,
    }),
  );
}

describe("month window", () => {
  it("follows the business's time zone", () => {
    // 23:30 UTC on 31 Oct is already 1 Nov in Paris, still 31 Oct in New York.
    const now = new Date("2026-10-31T23:30:00Z");
    expect(monthWindow(now, "Europe/Paris").month).toBe("2026-11");
    expect(monthWindow(now, "America/New_York").month).toBe("2026-10");
    const london = monthWindow(new Date("2026-10-24T12:00:00Z"), "Europe/London");
    // October starts in summer time (UTC+1) and November in winter time (UTC+0).
    expect(london.from.toISOString()).toBe("2026-09-30T23:00:00.000Z");
    expect(london.to.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("spend this month", () => {
  it("adds up AI, voice minutes and texts with the cost estimates", async () => {
    const biz = await createOwnerWithTenant(h, "Spend Co");
    const settings = await getPlatformSpendSettings(h.db);
    await addAiCost(biz.tenantId, 0.3);
    const ctx = await loadAgentContext(h.db, biz.tenantId, "voice");
    const call = await createConversation(h.db, ctx, {
      tenantId: biz.tenantId,
      channel: "voice",
      callerPhone: "+447700900111",
    });
    const started = new Date();
    await withTenant(h.db, biz.tenantId, (tx) =>
      tx
        .update(conversations)
        .set({ startedAt: started, endedAt: new Date(started.getTime() + 90_000), status: "ended" })
        .where(eq(conversations.id, call.conversationId)),
    );
    await recordSmsSpend(h.db, biz.tenantId, 3);

    const status = await spendStatus(h.db, biz.tenantId);
    expect(status.categories.ai.spent).toBeCloseTo(30 * settings.costs.usdToGbp);
    // 90 seconds bills as 2 minutes; a browser call has no carrier charge.
    expect(status.categories.calls.spent).toBeCloseTo(2 * settings.costs.voicePencePerMinute);
    expect(status.categories.sms.spent).toBeCloseTo(3 * settings.costs.smsPencePerSegment);
    // By default a business's limit is its whole allowance (its plan).
    expect(status.categories.ai).toMatchObject({ cap: settings.maxCapPence.ai, state: "ok" });
  });

  it("pauses the AI when the allowance is used up: the assistant takes messages instead", async () => {
    const biz = await createOwnerWithTenant(h, "Capped Co");
    const { maxCapPence, costs } = await getPlatformSpendSettings(h.db);
    await addAiCost(biz.tenantId, 0.2);
    expect((await loadAgentContext(h.db, biz.tenantId, "chat")).aiPaused).toBeNull();
    // Enough dollars to pass the AI allowance.
    await addAiCost(biz.tenantId, maxCapPence.ai / 100 / costs.usdToGbp);
    expect((await loadAgentContext(h.db, biz.tenantId, "chat")).aiPaused).toBe("cap");
  });
});

describe("spend alerts", () => {
  it("emails owners at 80% and 100% of the allowance, once each per month", async () => {
    const platform = await signUpVerified(h, "AlertPlatform");
    await makePlatformOwner(h, platform);
    const biz = await createOwnerWithTenant(h, "Alert Co");
    const { maxCapPence, costs } = await getPlatformSpendSettings(h.db);
    const dollarsFor = (share: number) => (maxCapPence.ai / 100 / costs.usdToGbp) * share;
    await addAiCost(biz.tenantId, dollarsFor(0.85));
    const run = () => planSpendAlerts(h.db, new Date(), ORIGIN, [biz.tenantId]);
    const first = await run();
    expect(first).toHaveLength(1);
    const warning = first[0]!.plan.messages;
    expect(warning.filter((m) => m.to === biz.email)).toHaveLength(1);
    expect(warning.find((m) => m.to === biz.email)!.subject).toMatch(
      /80% of this month's AI allowance/,
    );
    expect(await run()).toEqual([]); // not again

    await addAiCost(biz.tenantId, dollarsFor(0.2));
    const second = await run();
    const reached = second[0]!.plan.messages;
    const mine = reached.find((m) => m.to === biz.email)!;
    expect(mine.subject).toMatch(/AI allowance is used up/);
    expect(mine.text).toMatch(/takes messages/);
    expect(mine.text).toMatch(/Contact VoiceDesk support for a bigger allowance/);
    // The platform owners get a copy at 100% (not at 80%).
    expect(reached.find((m) => m.to === platform.email)!.subject).toMatch(/^\[Platform\]/);
    expect(warning.some((m) => m.to === platform.email)).toBe(false);
    expect(await run()).toEqual([]);
  });
});

describe("limits", () => {
  it("come from the plan by default: businesses can't set their own", async () => {
    const biz = await createOwnerWithTenant(h, "Plan Co");
    const view = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/spend`,
      headers: as(biz.cookie),
    });
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({ businessCaps: false, canEdit: false, suspended: false });
    const refused = await h.app.inject({
      method: "PUT",
      url: `/api/tenants/${biz.tenantId}/spend`,
      headers: as(biz.cookie),
      payload: { ai: 500 },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: "PLAN_LIMITS_ONLY" });

    const other = await createOwnerWithTenant(h, "Other Plan Co");
    const hidden = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/spend`,
      headers: as(other.cookie),
    });
    expect(hidden.statusCode).toBe(404);
  });

  it("when the platform allows it, a business's own lower limit applies", async () => {
    const biz = await createOwnerWithTenant(h, "Own Caps Co");
    const base = await getPlatformSpendSettings(h.db);
    await setCaps(biz.tenantId, { ai: 500, sms: 0 });
    const planOnly = await spendStatus(h.db, biz.tenantId, new Date(), base);
    expect(planOnly.categories.ai.cap).toBe(base.maxCapPence.ai);
    const own = await spendStatus(h.db, biz.tenantId, new Date(), { ...base, businessCaps: true });
    expect(own.categories.ai.cap).toBe(500);
    // A zero texts limit means no texts at all.
    expect(own.categories.sms.state).toBe("reached");
    // A cap above the allowance counts as the allowance.
    await setCaps(biz.tenantId, { calls: base.maxCapPence.calls * 10 });
    const capped = await spendStatus(h.db, biz.tenantId, new Date(), {
      ...base,
      businessCaps: true,
    });
    expect(capped.categories.calls.cap).toBe(base.maxCapPence.calls);
  });
});

describe("send guard", () => {
  it("refuses premium, foreign, capped and paused sends", async () => {
    const biz = await createOwnerWithTenant(h, "Guard Co");
    const base = await getPlatformSpendSettings(h.db);
    const check = (to: string, kind: "sms" | "call" = "call", settings = base) =>
      checkSend(h.db, { tenantId: biz.tenantId, kind, to, settings });

    expect(await check("+447700900123")).toEqual({ ok: true });
    expect(await check("+447624123456")).toEqual({ ok: true }); // Isle of Man mobile
    expect(await check("+449098790000")).toEqual({ ok: false, reason: "premium" });
    expect(await check("+448712345678")).toEqual({ ok: false, reason: "premium" });
    expect(await check("+447612345678")).toEqual({ ok: false, reason: "premium" }); // pager
    expect(await check("+2348012345678")).toEqual({ ok: false, reason: "country" });
    expect(await check("+353861234567")).toEqual({ ok: false, reason: "country" });
    const withIreland = { ...base, allowedCountries: ["GB", "IE"] };
    expect(await check("+353861234567", "call", withIreland)).toEqual({ ok: true });
    const textsPaused = { ...base, paused: { ...base.paused, sms: true } };
    expect(await check("+447700900123", "sms", textsPaused)).toEqual({
      ok: false,
      reason: "paused",
    });
    expect(await check("+447700900123", "call", textsPaused)).toEqual({ ok: true });

    // A business's own zero texts limit (when the platform allows own limits).
    await setCaps(biz.tenantId, { sms: 0 });
    expect(await check("+447700900123", "sms")).toEqual({ ok: true });
    const ownLimits = { ...base, businessCaps: true };
    expect(await check("+447700900123", "sms", ownLimits)).toEqual({ ok: false, reason: "cap" });
  });

  it("refuses premium numbers as the transfer number", async () => {
    const biz = await createOwnerWithTenant(h, "Transfer Co");
    const current = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/agent`,
      headers: as(biz.cookie),
    });
    const settings = current.json<{ settings: Record<string, unknown> }>().settings;
    const res = await h.app.inject({
      method: "PUT",
      url: `/api/tenants/${biz.tenantId}/agent`,
      headers: as(biz.cookie),
      payload: { ...settings, transferPhone: "09098 790000" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "PHONE_NOT_ALLOWED" });
  });
});

describe("phoning customers needs calls:outbound", () => {
  it("staff can't, unless the business allows people who answer calls to", async () => {
    const biz = await createOwnerWithTenant(h, "Dial Co");
    const staff = await signUpVerified(h, "Dialler");
    await h.app.inject({
      method: "POST",
      url: "/api/auth/organization/invite-member",
      headers: as(biz.cookie),
      payload: { email: staff.email, role: "staff", organizationId: biz.tenantId },
    });
    const invitationId = /accept-invite\/([0-9a-f-]+)/.exec(lastEmailTo(h, staff.email).text)![1]!;
    await h.app.inject({
      method: "POST",
      url: "/api/auth/organization/accept-invitation",
      headers: as(staff.cookie),
      payload: { invitationId },
    });
    const dial = () =>
      h.app.inject({
        method: "POST",
        url: `/api/tenants/${biz.tenantId}/outbound-calls`,
        headers: as(staff.cookie),
        payload: { to: "07700 900123" },
      });
    const refused = await dial();
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: "CALLS_OUTBOUND_OFF" });

    await withTenant(h.db, biz.tenantId, (tx) =>
      tx
        .insert(agentSettings)
        .values({ tenantId: biz.tenantId, answerersCanCallOut: true })
        .onConflictDoUpdate({ target: agentSettings.tenantId, set: { answerersCanCallOut: true } }),
    );
    // Allowed now: it gets past the permission (and stops later: not an answerer here).
    expect((await dial()).json()).not.toMatchObject({ error: "CALLS_OUTBOUND_OFF" });
  });
});

describe("platform: spending overview and suspend", () => {
  it("lists spend per business and suspends one (fixed answers, no sends)", async () => {
    const p = await signUpVerified(h, "SpendPlatform");
    await makePlatformOwner(h, p);
    const biz = await createOwnerWithTenant(h, "Suspend Co");

    const overview = await h.app.inject({
      method: "GET",
      url: "/api/platform/spend-settings",
      headers: as(p.cookie),
    });
    expect(overview.statusCode).toBe(200);
    const body = overview.json<{
      businesses: Array<{ tenantId: string; spend: { categories: unknown } }>;
    }>();
    const mine = body.businesses.find((b) => b.tenantId === biz.tenantId);
    // The grouped overview agrees with the per-business calculation.
    expect(mine?.spend.categories).toEqual((await spendStatus(h.db, biz.tenantId)).categories);

    const setStatus = (status: "active" | "suspended") =>
      h.app.inject({
        method: "PUT",
        url: `/api/platform/businesses/${biz.tenantId}/status`,
        headers: as(p.cookie),
        payload: { status },
      });
    expect((await setStatus("suspended")).statusCode).toBe(200);
    const ctx = await loadAgentContext(h.db, biz.tenantId, "chat");
    expect(ctx).toMatchObject({ suspended: true, aiPaused: "platform" });
    expect(
      await checkSend(h.db, { tenantId: biz.tenantId, kind: "sms", to: "+447700900123" }),
    ).toEqual({ ok: false, reason: "suspended" });
    const spend = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/spend`,
      headers: as(biz.cookie),
    });
    expect(spend.json()).toMatchObject({ suspended: true });

    await reauth(h, p.cookie);
    expect((await setStatus("active")).statusCode).toBe(200);
    expect((await loadAgentContext(h.db, biz.tenantId, "chat")).suspended).toBe(false);
  });

  it("saves the settings (same values, so tests running in parallel aren't affected)", async () => {
    const p = await signUpVerified(h, "SpendSettings");
    await makePlatformOwner(h, p);
    const current = await getPlatformSpendSettings(h.db);
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/platform/spend-settings",
      headers: as(p.cookie),
      payload: { maxCapPence: current.maxCapPence, allowedCountries: current.allowedCountries },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ settings: current });
    const bad = await h.app.inject({
      method: "PUT",
      url: "/api/platform/spend-settings",
      headers: as(p.cookie),
      payload: { allowedCountries: ["XX"] },
    });
    expect(bad.statusCode).toBe(400);
  });
});
