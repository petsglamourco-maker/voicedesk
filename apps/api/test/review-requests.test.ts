import { createConversation, loadAgentContext, openSurvey } from "@voicedesk/agent-brain";
import { feedback, withTenant } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, createOwnerWithTenant, ORIGIN, type TestHarness } from "./harness";

const LINK = "https://g.page/r/review-co/review";
let h: TestHarness;
let biz: Awaited<ReturnType<typeof createOwnerWithTenant>>;

beforeAll(async () => {
  h = await createHarness();
  biz = await createOwnerWithTenant(h, "Review Co");
});
afterAll(() => h.close());

async function save(changes: Record<string, unknown>) {
  const current = await h.app.inject({
    method: "GET",
    url: `/api/tenants/${biz.tenantId}/agent`,
    headers: { cookie: biz.cookie },
  });
  const { settings } = current.json<{ settings: Record<string, unknown> }>();
  return h.app.inject({
    method: "PUT",
    url: `/api/tenants/${biz.tenantId}/agent`,
    headers: { cookie: biz.cookie, origin: ORIGIN },
    payload: { ...settings, reviewLink: null, ...changes },
  });
}

async function survey() {
  const ctx = await loadAgentContext(h.db, biz.tenantId, "chat");
  const { conversationId } = await createConversation(h.db, ctx, {
    tenantId: biz.tenantId,
    channel: "web_chat",
  });
  return (await openSurvey(h.db, {
    tenantId: biz.tenantId,
    conversationId,
    channel: "web_chat",
  }))!;
}

describe("review requests (ADR 0028)", () => {
  it("needs the business's own https review page", async () => {
    expect((await save({ reviewRequests: true })).json()).toMatchObject({
      error: "REVIEW_LINK_REQUIRED",
    });
    expect(
      (await save({ reviewRequests: true, reviewLink: "http://example.com/r" })).json(),
    ).toMatchObject({ error: "INVALID_REVIEW_LINK" });
    expect((await save({ reviewRequests: true, reviewLink: LINK })).statusCode).toBe(204);
    const settings = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/agent`,
      headers: { cookie: biz.cookie },
    });
    expect(settings.json()).toMatchObject({
      settings: { reviewRequests: true, reviewLink: LINK },
    });
  });

  it("invites a customer who gave a low score too; the link redirects only to the stored page", async () => {
    await save({ reviewRequests: true, reviewLink: LINK });
    const s = await survey();
    const res = await h.app.inject({
      method: "POST",
      url: `/api/public/feedback/${s.token}`,
      headers: { origin: ORIGIN },
      payload: { score: 2 },
    });
    const body = res.json<{ low: boolean; review: { url: string; text: string } }>();
    expect(body.low).toBe(true);
    expect(body.review.url).toBe(`/api/public/review/${encodeURIComponent(s.token)}`);
    expect(body.review.text).toContain("Review Co");

    const open = await h.app.inject({ method: "GET", url: body.review.url });
    expect(open.statusCode).toBe(302);
    expect(open.headers.location).toBe(LINK);
    const [row] = await withTenant(h.db, biz.tenantId, (tx) =>
      tx.select().from(feedback).where(eq(feedback.id, s.id)),
    );
    expect(row?.reviewClickedAt).toBeInstanceOf(Date);

    const stats = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/feedback`,
      headers: { cookie: biz.cookie },
    });
    expect(stats.json()).toMatchObject({ overall: { reviewsOffered: 1, reviewsOpened: 1 } });
  });

  it("a survey without an invitation can't be used as a redirect", async () => {
    await save({ reviewRequests: false, reviewLink: LINK });
    const s = await survey();
    await h.app.inject({
      method: "POST",
      url: `/api/public/feedback/${s.token}`,
      headers: { origin: ORIGIN },
      payload: { score: 5 },
    });
    const open = await h.app.inject({
      method: "GET",
      url: `/api/public/review/${encodeURIComponent(s.token)}`,
    });
    expect(open.statusCode).toBe(404);
  });
});
