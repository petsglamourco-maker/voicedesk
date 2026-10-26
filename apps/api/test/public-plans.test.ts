import { PLANS } from "@voicedesk/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type TestHarness } from "./harness";

let h: TestHarness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe("public plans (ADR 0030)", () => {
  it("lists the paid plans with the prices billing uses, without signing in", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/public/plans" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      trialDays: number;
      plans: Array<{ id: string; pricePence: number }>;
    }>();
    expect(body.trialDays).toBe(14);
    expect(body.plans.map((p) => [p.id, p.pricePence])).toEqual([
      ["starter", PLANS.starter.pricePence],
      ["growth", PLANS.growth.pricePence],
      ["pro", PLANS.pro.pricePence],
    ]);
  });
});
