import { MockBilling } from "@voicedesk/adapters";
import { PLAN_PRICES } from "@voicedesk/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planForPrice, toPriceMap } from "../src/lib/billing";
import { createHarness, ORIGIN, reauth, signUpVerified, type TestHarness } from "./harness";

const PRICES = {
  starter: "price_starter",
  growth: "price_growth",
  pro: "price_pro",
  starter_usd: "price_starter_usd",
  growth_usd: "price_growth_usd",
  pro_usd: "price_pro_usd",
};
const billing = new MockBilling();
let h: TestHarness;

beforeAll(async () => {
  h = await createHarness({
    billing,
    billingPrices: PRICES,
    countrySettings: { launched: ["US", "IE"], smsRegistered: [] },
  });
});
afterAll(() => h.close());

async function business(countryCode: string, timezone: string) {
  const owner = await signUpVerified(h, "Owner");
  const res = await h.app.inject({
    method: "POST",
    url: "/api/tenants",
    headers: { cookie: owner.cookie, origin: ORIGIN },
    payload: { name: `${countryCode} Co`, countryCode, timezone, defaultLanguage: "en" },
  });
  expect(res.statusCode).toBe(201);
  return { ...owner, tenantId: res.json<{ id: string }>().id };
}

describe("local-currency pricing (ADR 0031)", () => {
  it("a US business sees dollar prices and checks out with the USD price", async () => {
    const biz = await business("US", "America/New_York");
    const view = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/billing`,
      headers: { cookie: biz.cookie },
    });
    const body = view.json<{
      billingReady: boolean;
      plans: Array<{ id: string; price: number; currency: string; available: boolean }>;
    }>();
    expect(body.billingReady).toBe(true);
    expect(body.plans.find((p) => p.id === "growth")).toMatchObject({
      price: PLAN_PRICES.growth.USD,
      currency: "USD",
      available: true,
    });

    await reauth(h, biz.cookie);
    const checkout = await h.app.inject({
      method: "POST",
      url: `/api/tenants/${biz.tenantId}/billing/checkout`,
      headers: { cookie: biz.cookie, origin: ORIGIN },
      payload: { planId: "growth" },
    });
    expect(checkout.statusCode).toBe(200);
    expect(billing.checkouts.at(-1)?.priceId).toBe("price_growth_usd");
  });

  it("a currency without Stripe prices yet can't be bought", async () => {
    const biz = await business("IE", "Europe/Dublin");
    const view = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/billing`,
      headers: { cookie: biz.cookie },
    });
    expect(view.json()).toMatchObject({ billingReady: false });
    await reauth(h, biz.cookie);
    const checkout = await h.app.inject({
      method: "POST",
      url: `/api/tenants/${biz.tenantId}/billing/checkout`,
      headers: { cookie: biz.cookie, origin: ORIGIN },
      payload: { planId: "growth" },
    });
    expect(checkout.json()).toMatchObject({ error: "BILLING_NOT_SET_UP" });
  });

  it("webhooks map a price in any currency back to its plan", () => {
    const prices = toPriceMap(PRICES);
    expect(planForPrice(prices, "price_pro_usd")).toBe("pro");
    expect(planForPrice(prices, "price_starter")).toBe("starter");
    expect(planForPrice(prices, "price_unknown")).toBeNull();
  });

  it("the website lists prices in the currency asked for", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/public/plans?currency=aud" });
    const body = res.json<{ currency: string; plans: Array<{ id: string; price: number }> }>();
    expect(body.currency).toBe("AUD");
    expect(body.plans.map((p) => p.price)).toEqual([
      PLAN_PRICES.starter.AUD,
      PLAN_PRICES.growth.AUD,
      PLAN_PRICES.pro.AUD,
    ]);
  });
});
