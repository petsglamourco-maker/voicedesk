import {
  createConversation,
  loadAgentContext,
  recordDepartmentChoice,
} from "@voicedesk/agent-brain";
import { auditLog, withTenant } from "@voicedesk/db";
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
  platform = await signUpVerified(h, "DeptPlatform");
  await makePlatformOwner(h, platform);
});
afterAll(() => h.close());

const as = (cookie: string) => ({ cookie, origin: ORIGIN });

interface MenuView {
  menuEnabled: boolean;
  departments: Array<{
    id: string;
    key: number;
    name: string;
    transferPhone: string | null;
    memberIds: string[];
  }>;
  preview: string | null;
}

async function save(biz: { tenantId: string; cookie: string }, body: object) {
  return h.app.inject({
    method: "PUT",
    url: `/api/tenants/${biz.tenantId}/departments`,
    headers: as(biz.cookie),
    payload: { menuEnabled: true, menuHours: "always", menuOnChat: false, ...body },
  });
}

describe("departments and the phone menu", () => {
  it("saves the menu, previews what callers hear, and swaps keys", async () => {
    const biz = await createOwnerWithTenant(h, "Menu Co");
    const res = await save(biz, {
      departments: [
        { key: 1, name: "Sales", transferPhone: "020 7946 0018" },
        { key: 2, name: "Support", instructions: "Ask for the order number first." },
        { key: 3, name: "Payments", paymentLink: "https://buy.stripe.com/test_abc" },
      ],
    });
    expect(res.statusCode).toBe(200);
    const view = res.json<MenuView>();
    expect(view.departments.map((d) => [d.key, d.name])).toEqual([
      [1, "Sales"],
      [2, "Support"],
      [3, "Payments"],
    ]);
    expect(view.departments[0]!.transferPhone).toBe("+442079460018");
    expect(view.preview).toBe(
      "For Sales, press 1. For Support, press 2. For Payments, press 3. Or just tell me what you need.",
    );

    // Swap Sales and Support keys, drop Payments.
    const [sales, support] = view.departments;
    const swapped = await save(biz, {
      departments: [
        { id: support!.id, key: 1, name: "Support" },
        { id: sales!.id, key: 2, name: "Sales" },
      ],
    });
    expect(swapped.statusCode).toBe(200);
    expect(swapped.json<MenuView>().departments.map((d) => [d.key, d.name, d.id])).toEqual([
      [1, "Support", support!.id],
      [2, "Sales", sales!.id],
    ]);

    const audits = await withTenant(h.db, biz.tenantId, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.tenantId, biz.tenantId), eq(auditLog.action, "departments.updated")),
        ),
    );
    expect(audits.at(-1)?.metadata).toMatchObject({ paymentLinksChanged: true });
  });

  it("refuses duplicate keys, premium transfer numbers and plain-http payment links", async () => {
    const biz = await createOwnerWithTenant(h, "Bad Menu Co");
    const dup = await save(biz, {
      departments: [
        { key: 1, name: "Sales" },
        { key: 1, name: "Support" },
      ],
    });
    expect(dup.json()).toMatchObject({ error: "DUPLICATE_KEY" });
    const premium = await save(biz, {
      departments: [{ key: 1, name: "Sales", transferPhone: "09098 790 000" }],
    });
    expect(premium.json()).toMatchObject({ error: "PHONE_NOT_ALLOWED" });
    const http = await save(biz, {
      departments: [{ key: 1, name: "Payments", paymentLink: "http://pay.example.com" }],
    });
    expect(http.statusCode).toBe(400);
  });

  it("only members of the business can be in a department", async () => {
    const biz = await createOwnerWithTenant(h, "Members Co");
    const owner = await h.db.query.member.findFirst({
      where: (m, { eq: e }) => e(m.organizationId, biz.tenantId),
    });
    const ok = await save(biz, {
      departments: [{ key: 1, name: "Sales", memberIds: [owner!.userId] }],
    });
    expect(ok.json<MenuView>().departments[0]!.memberIds).toEqual([owner!.userId]);
    const stranger = await createOwnerWithTenant(h, "Stranger Co");
    const strangerMember = await h.db.query.member.findFirst({
      where: (m, { eq: e }) => e(m.organizationId, stranger.tenantId),
    });
    const bad = await save(biz, {
      departments: [{ key: 1, name: "Sales", memberIds: [strangerMember!.userId] }],
    });
    expect(bad.json()).toMatchObject({ error: "NOT_A_MEMBER" });
  });

  it("is a Growth and Pro feature", async () => {
    const biz = await createOwnerWithTenant(h, "Starter Menu Co");
    const plan = await h.app.inject({
      method: "PUT",
      url: `/api/platform/tenants/${biz.tenantId}/plan`,
      headers: as(platform.cookie),
      payload: { planId: "starter" },
    });
    expect(plan.statusCode).toBe(200);
    const res = await save(biz, { departments: [{ key: 1, name: "Sales" }] });
    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ error: "PLAN_FEATURE" });
  });

  it("is invisible to other businesses", async () => {
    const biz = await createOwnerWithTenant(h, "Private Menu Co");
    const other = await createOwnerWithTenant(h, "Nosy Co");
    const res = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/departments`,
      headers: as(other.cookie),
    });
    expect(res.statusCode).toBe(404);
  });

  it("calls show their department, a filter, the moves and missed calls", async () => {
    const biz = await createOwnerWithTenant(h, "Calls Dept Co");
    const saved = (
      await save(biz, {
        departments: [
          { key: 1, name: "Sales" },
          { key: 2, name: "Support" },
        ],
      })
    ).json<MenuView>();
    const [sales, support] = saved.departments;
    const ctx = await loadAgentContext(h.db, biz.tenantId, "voice");
    const missed = await createConversation(h.db, ctx, {
      tenantId: biz.tenantId,
      channel: "voice",
      entry: "forwarded",
      menu: "voice",
    });
    expect(missed.greeting).toContain("For Sales, press 1");
    expect(missed.greeting).toContain("couldn't get to the phone");
    await recordDepartmentChoice(h.db, {
      tenantId: biz.tenantId,
      conversationId: missed.conversationId,
      departmentId: sales!.id,
      via: "keypad",
    });
    await recordDepartmentChoice(h.db, {
      tenantId: biz.tenantId,
      conversationId: missed.conversationId,
      departmentId: support!.id,
      via: "assistant",
    });
    const other = await createConversation(h.db, ctx, { tenantId: biz.tenantId, channel: "voice" });

    const list = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/calls?department=${support!.id}`,
      headers: as(biz.cookie),
    });
    const calls = list.json<{
      calls: Array<{ id: string; department: string; missedByTeam: boolean }>;
    }>().calls;
    expect(calls.map((c) => c.id)).toEqual([missed.conversationId]);
    expect(calls[0]).toMatchObject({ department: "Support", missedByTeam: true });
    expect(calls.some((c) => c.id === other.conversationId)).toBe(false);

    const detail = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/calls/${missed.conversationId}`,
      headers: as(biz.cookie),
    });
    expect(
      detail.json<{ departmentMoves: Array<{ via: string; name: string }> }>().departmentMoves,
    ).toEqual([
      expect.objectContaining({ via: "keypad", name: "Sales" }),
      expect.objectContaining({ via: "assistant", name: "Support" }),
    ]);
  });
});
