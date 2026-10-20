import { createConversation, loadAgentContext, openSurvey } from "@voicedesk/agent-brain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, createOwnerWithTenant, ORIGIN, type TestHarness } from "./harness";

let h: TestHarness;
let biz: Awaited<ReturnType<typeof createOwnerWithTenant>>;
let other: Awaited<ReturnType<typeof createOwnerWithTenant>>;

beforeAll(async () => {
  h = await createHarness();
  biz = await createOwnerWithTenant(h, "Rated Co");
  other = await createOwnerWithTenant(h, "Other Co");
});
afterAll(() => h.close());

async function survey(channel: "web_chat" | "whatsapp" = "web_chat") {
  const ctx = await loadAgentContext(h.db, biz.tenantId, "chat");
  const { conversationId } = await createConversation(h.db, ctx, {
    tenantId: biz.tenantId,
    channel,
  });
  const opened = await openSurvey(h.db, { tenantId: biz.tenantId, conversationId, channel });
  return opened!;
}

describe("feedback", () => {
  it("customers answer by link once; a low score alerts the business", async () => {
    const s = await survey();
    const info = await h.app.inject({ method: "GET", url: `/api/public/feedback/${s.token}` });
    expect(info.json()).toEqual({
      businessName: "Rated Co",
      kind: "csat",
      question: "How did we do today?",
      answered: false,
      language: "en",
    });
    const before = h.jobs.notifications.length;
    const res = await h.app.inject({
      method: "POST",
      url: `/api/public/feedback/${s.token}`,
      payload: { score: 1 },
    });
    expect(res.json()).toEqual({ thanks: "Thank you for your feedback!", low: true });
    expect(h.jobs.notifications.slice(before)).toEqual([
      { kind: "staff.alert", tenantId: biz.tenantId, record: "feedback", id: s.id },
    ]);
    // A comment can follow; the score can't be changed.
    await h.app.inject({
      method: "POST",
      url: `/api/public/feedback/${s.token}`,
      payload: { score: 5, comment: "Kept me waiting" },
    });
    const again = await h.app.inject({ method: "GET", url: `/api/public/feedback/${s.token}` });
    expect(again.json()).toMatchObject({ answered: true });

    const bogus = await h.app.inject({
      method: "GET",
      url: `/api/public/feedback/${biz.tenantId}.${"x".repeat(24)}`,
    });
    expect(bogus.statusCode).toBe(404);
  });

  it("the dashboard adds it up per channel; other businesses can't see it", async () => {
    const good = await survey("whatsapp");
    await h.app.inject({
      method: "POST",
      url: `/api/public/feedback/${good.token}`,
      payload: { score: 5 },
    });
    const res = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/feedback?days=7`,
      headers: { cookie: biz.cookie, origin: ORIGIN },
    });
    const body = res.json<{
      overall: { answered: number; csat: number };
      byChannel: Array<{ channel: string; csat: number }>;
      latest: Array<{ comment: string | null }>;
    }>();
    expect(body.overall).toMatchObject({ answered: 2, csat: 50 });
    expect(body.byChannel).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: "whatsapp", csat: 100 }),
        expect.objectContaining({ channel: "web_chat", csat: 0 }),
      ]),
    );
    expect(body.latest.map((l) => l.comment)).toContain("Kept me waiting");

    const peek = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/feedback`,
      headers: { cookie: other.cookie, origin: ORIGIN },
    });
    expect(peek.statusCode).toBe(404);
  });
});

describe("daily brief preview", () => {
  it("shows today's brief without sending it", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/daily-brief/preview`,
      headers: { cookie: biz.cookie, origin: ORIGIN },
    });
    const body = res.json<{ subject: string; text: string; recipients: number }>();
    expect(body.subject).toMatch(/^Rated Co: your daily brief for \d{4}-\d{2}-\d{2}$/);
    expect(body.text).toContain("Yesterday");
    expect(body.recipients).toBe(1);
  });
});
