import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, createOwnerWithTenant, type TestHarness } from "./harness";

let h: TestHarness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe("value report (ADR 0028)", () => {
  it("previews this month or last month for the business's own team", async () => {
    const biz = await createOwnerWithTenant(h, "Value Co");
    const res = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/value-report?period=last_month`,
      headers: { cookie: biz.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      month: string;
      subject: string;
      text: string;
      recipients: number;
      numbers: { conversations: number; estimatedValuePence: number | null };
    }>();
    expect(body.month).toMatch(/^\d{4}-\d{2}$/);
    expect(body.subject).toContain("Value Co: what your assistant did in");
    expect(body.numbers).toMatchObject({ conversations: 0, estimatedValuePence: null });
    expect(body.recipients).toBe(1);

    const other = await createOwnerWithTenant(h, "Nosy Co");
    const nosy = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/value-report`,
      headers: { cookie: other.cookie },
    });
    expect(nosy.statusCode).toBe(404);
  });
});
