import { MockLlmProvider } from "@voicedesk/adapters";
import { planSupportRequest } from "@voicedesk/agent-brain";
import { user } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizePage } from "../src/routes/help";
import {
  createHarness,
  createOwnerWithTenant,
  ORIGIN,
  signUpVerified,
  type TestHarness,
} from "./harness";

/** A mock model that counts as a real, switched-on provider. */
class OnLlm extends MockLlmProvider {
  available() {
    return Promise.resolve(true);
  }
}

const llm = new OnLlm();
let h: TestHarness;
let owner: Awaited<ReturnType<typeof createOwnerWithTenant>>;
let platform: { email: string; cookie: string; id: string };

const as = (cookie: string) => ({ cookie, origin: ORIGIN });

/** SSE body → events. */
const events = (payload: string) =>
  payload
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      return { event, data: data ? (JSON.parse(data) as Record<string, unknown>) : null };
    });

beforeAll(async () => {
  h = await createHarness({ llm });
  owner = await createOwnerWithTenant(h, "Help Co");
  const p = await signUpVerified(h, "PlatformHelp");
  await h.db
    .update(user)
    .set({ isPlatformOwner: true, twoFactorEnabled: true })
    .where(eq(user.email, p.email));
  const [row] = await h.db.select({ id: user.id }).from(user).where(eq(user.email, p.email));
  platform = { ...p, id: row!.id };
});
afterAll(() => h.close());

describe("normalizePage", () => {
  it("removes ids and query strings", () => {
    expect(
      normalizePage(
        "/t/5e2d8e81-4cb1-4a4c-891e-af4f18e21db2/calls/9c36a8cf-74cd-41fd-a4f2-a96a1007ceac?x=1",
      ),
    ).toBe("/t/:tenant/calls/:id");
    expect(normalizePage("/va")).toBe("/va");
  });
});

describe("Help assistant API", () => {
  it("gives starter questions for a screen, signed-in only", async () => {
    const anon = await h.app.inject({ method: "GET", url: "/api/help/suggestions?page=/t/x" });
    expect(anon.statusCode).toBe(401);
    const res = await h.app.inject({
      method: "GET",
      url: `/api/help/suggestions?page=/t/${owner.tenantId}/integrations`,
      headers: as(owner.cookie),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ suggestions: string[] }>().suggestions.length).toBeGreaterThan(0);
  });

  it("answers with AI, checking the business setup, with links to this business", async () => {
    llm.enqueue(
      MockLlmProvider.toolUse("get_my_setup", {}),
      MockLlmProvider.text(
        "Your calendar isn't connected. Open [Integrations](/t/:tenant/integrations).",
      ),
    );
    const res = await h.app.inject({
      method: "POST",
      url: "/api/help/ask",
      headers: as(owner.cookie),
      payload: {
        question: "Why aren't bookings in my calendar?",
        tenantId: owner.tenantId,
        page: `/t/${owner.tenantId}/integrations`,
      },
    });
    const done = events(res.payload).find((e) => e.event === "done")!.data!;
    expect(done.mode).toBe("ai");
    expect(done.answer).toContain(`/t/${owner.tenantId}/integrations`);
    // The facts the model saw are yes/no setup facts for this business.
    const facts = JSON.stringify(llm.requests.at(-1)!.messages);
    expect(facts).toContain("not connected");
    expect(facts).toContain("serverFeatures");
  });

  it("hides businesses the person doesn't belong to", async () => {
    const stranger = await signUpVerified(h, "Stranger");
    const res = await h.app.inject({
      method: "POST",
      url: "/api/help/ask",
      headers: as(stranger.cookie),
      payload: { question: "hi", tenantId: owner.tenantId },
    });
    expect(res.statusCode).toBe(404);
  });

  it("answers from the articles alone when there's no business", async () => {
    const before = llm.requests.length;
    const res = await h.app.inject({
      method: "POST",
      url: "/api/help/ask",
      headers: as(owner.cookie),
      payload: { question: "How do I connect Google Calendar?", page: "/va" },
    });
    const done = events(res.payload).find((e) => e.event === "done")!.data!;
    expect(done.mode).toBe("articles");
    expect(typeof done.answer).toBe("string");
    expect(llm.requests.length).toBe(before); // no AI cost
  });
});

describe("Contact support", () => {
  let requestId: string;

  it("stores the request, queues the email and audits it", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/help/support",
      headers: as(owner.cookie),
      payload: {
        message: "The calendar keeps disconnecting.",
        tenantId: owner.tenantId,
        page: `/t/${owner.tenantId}/integrations?calendar=failed`,
        chat: [
          { role: "user", text: "Why does my calendar disconnect?" },
          { role: "assistant", text: "Let me help." },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    requestId = res.json<{ id: string }>().id;
    expect(h.jobs.notifications).toContainEqual({ kind: "support.request", requestId });
  });

  it("emails every platform owner, replies going to the person who asked", async () => {
    const plan = await planSupportRequest(h.db, { requestId }, "http://localhost:3000");
    const mine = plan.messages.find((m) => m.to === platform.email);
    expect(mine).toMatchObject({ channel: "email", replyTo: owner.email, kind: "support.request" });
    expect(mine!.subject).toContain("Help Co");
    expect(mine!.text).toContain("The calendar keeps disconnecting.");
    expect(mine!.text).toContain("/t/:tenant/integrations"); // page stored without ids
    expect(mine!.text).toContain("Why does my calendar disconnect?");
  });

  it("is listed and resolved only by the platform owner", async () => {
    const hidden = await h.app.inject({
      method: "GET",
      url: "/api/platform/support-requests",
      headers: as(owner.cookie),
    });
    expect(hidden.statusCode).toBe(404);

    const list = await h.app.inject({
      method: "GET",
      url: "/api/platform/support-requests?status=open",
      headers: as(platform.cookie),
    });
    const mine = list
      .json<{ requests: Array<{ id: string; business: string; from: { email: string } }> }>()
      .requests.find((r) => r.id === requestId);
    expect(mine).toMatchObject({ business: "Help Co", from: { email: owner.email } });

    const resolved = await h.app.inject({
      method: "PATCH",
      url: `/api/platform/support-requests/${requestId}`,
      headers: as(platform.cookie),
      payload: { status: "resolved" },
    });
    expect(resolved.json()).toMatchObject({ status: "resolved" });
    const notMine = await h.app.inject({
      method: "PATCH",
      url: `/api/platform/support-requests/${requestId}`,
      headers: as(owner.cookie),
      payload: { status: "open" },
    });
    expect(notMine.statusCode).toBe(404);
  });

  it("works without a business too", async () => {
    const va = await signUpVerified(h, "LoneVa");
    const res = await h.app.inject({
      method: "POST",
      url: "/api/help/support",
      headers: as(va.cookie),
      payload: { message: "How do I get added to a business?", page: "/va" },
    });
    expect(res.statusCode).toBe(201);
  });
});
