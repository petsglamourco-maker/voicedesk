import { MockVoiceTyping } from "@voicedesk/adapters";
import { agentSettings, llmUsage, withTenant } from "@voicedesk/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, createOwnerWithTenant, ORIGIN, type TestHarness } from "./harness";

const voiceTyping = new MockVoiceTyping();
let h: TestHarness;
let off: TestHarness;

beforeAll(async () => {
  h = await createHarness({ voiceTyping });
  off = await createHarness();
});
afterAll(async () => {
  await h.close();
  await off.close();
});

const as = (cookie: string) => ({ cookie, origin: ORIGIN });

async function token(harness: TestHarness, biz: { tenantId: string; cookie: string }) {
  return harness.app.inject({
    method: "POST",
    url: `/api/tenants/${biz.tenantId}/voice-typing/token`,
    headers: as(biz.cookie),
    payload: { language: "fr" },
  });
}

async function detail(harness: TestHarness, biz: { tenantId: string; cookie: string }) {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/tenants/${biz.tenantId}`,
    headers: as(biz.cookie),
  });
  return res.json<{ voiceTyping: boolean }>().voiceTyping;
}

describe("voice typing", () => {
  it("gives a short-lived token (never our key) and records the usage", async () => {
    const biz = await createOwnerWithTenant(h, "Mic Co");
    expect(await detail(h, biz)).toBe(true);
    const res = await token(h, biz);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      token: "mock-token",
      expiresIn: 30,
      url: "wss://voice-typing.mock/listen?language=fr",
      protocol: "bearer",
    });
    expect(voiceTyping.grants.at(-1)).toBe("fr");
    const usage = await withTenant(h.db, biz.tenantId, (tx) =>
      tx
        .select()
        .from(llmUsage)
        .where(and(eq(llmUsage.tenantId, biz.tenantId), eq(llmUsage.purpose, "voice_typing"))),
    );
    expect(usage).toHaveLength(1);
    expect(Number(usage[0]!.costUsd)).toBeGreaterThan(0);
  });

  it("the business can switch it off for everyone", async () => {
    const biz = await createOwnerWithTenant(h, "Mic Off Co");
    await withTenant(h.db, biz.tenantId, (tx) =>
      tx
        .insert(agentSettings)
        .values({ tenantId: biz.tenantId, voiceTyping: false })
        .onConflictDoUpdate({ target: agentSettings.tenantId, set: { voiceTyping: false } }),
    );
    expect(await detail(h, biz)).toBe(false);
    expect((await token(h, biz)).json()).toMatchObject({ error: "VOICE_TYPING_OFF" });
  });

  it("each person can switch it off for themselves", async () => {
    const biz = await createOwnerWithTenant(h, "Mic Me Co");
    const put = await h.app.inject({
      method: "PUT",
      url: "/api/me/voice-typing",
      headers: as(biz.cookie),
      payload: { on: false },
    });
    expect(put.statusCode).toBe(200);
    const me = await h.app.inject({
      method: "GET",
      url: "/api/me/voice-typing",
      headers: as(biz.cookie),
    });
    expect(me.json()).toEqual({ available: true, on: false });
    expect(await detail(h, biz)).toBe(false);
    expect((await token(h, biz)).statusCode).toBe(403);
  });

  it("is hidden without Deepgram, and invisible to other businesses", async () => {
    const biz = await createOwnerWithTenant(off, "No Mic Co");
    expect(await detail(off, biz)).toBe(false);
    expect((await token(off, biz)).statusCode).toBe(403);
    const mine = await createOwnerWithTenant(h, "Mine Co");
    const other = await createOwnerWithTenant(h, "Other Mic Co");
    expect((await token(h, { tenantId: mine.tenantId, cookie: other.cookie })).statusCode).toBe(
      404,
    );
  });
});
