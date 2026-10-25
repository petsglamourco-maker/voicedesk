import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { StripeBilling } from "../src/billing/stripe";
import { BillingSignatureError, type BillingProvider } from "../src/billing/types";
import { MockBilling } from "../src/mocks";

/**
 * The webhook contract: a correctly signed event is reduced to what the platform needs, and
 * anything unsigned, re-signed or edited is refused. Offline: Stripe's own test-header helper
 * signs the payloads, so no network or Stripe account is needed.
 */
const WEBHOOK_SECRET = "whsec_test_contract";
const stripe = new StripeBilling({ secretKey: "sk_test_offline", webhookSecret: WEBHOOK_SECRET });
const helper = new Stripe("sk_test_offline");

function stripeSigned(event: object, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  return { payload, header: helper.webhooks.generateTestHeaderString({ payload, secret }) };
}

const checkoutEvent = {
  id: "evt_checkout_1",
  object: "event",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_1",
      object: "checkout.session",
      mode: "subscription",
      client_reference_id: "11111111-1111-4111-8111-111111111111",
      customer: "cus_1",
      subscription: "sub_1",
      metadata: {},
    },
  },
};

describe("Stripe webhook parsing", () => {
  it("reduces a signed checkout to the business, customer and subscription", async () => {
    const { payload, header } = stripeSigned(checkoutEvent);
    expect(await stripe.parseWebhook(payload, header)).toEqual({
      id: "evt_checkout_1",
      kind: "checkout_completed",
      tenantId: "11111111-1111-4111-8111-111111111111",
      customerId: "cus_1",
      subscriptionId: "sub_1",
    });
  });

  it("reduces subscription changes to the subscription id", async () => {
    const { payload, header } = stripeSigned({
      id: "evt_sub_1",
      object: "event",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", object: "subscription", metadata: { tenantId: "t1" } } },
    });
    expect(await stripe.parseWebhook(payload, header)).toEqual({
      id: "evt_sub_1",
      kind: "subscription_changed",
      subscriptionId: "sub_1",
      tenantId: "t1",
    });
  });

  it("ignores events it doesn't need", async () => {
    const { payload, header } = stripeSigned({
      id: "evt_x",
      object: "event",
      type: "charge.succeeded",
      data: { object: { id: "ch_1", object: "charge" } },
    });
    expect(await stripe.parseWebhook(payload, header)).toMatchObject({ kind: "ignored" });
  });

  it("refuses missing, wrong-secret and edited payloads", async () => {
    const { payload, header } = stripeSigned(checkoutEvent);
    await expect(stripe.parseWebhook(payload, undefined)).rejects.toBeInstanceOf(
      BillingSignatureError,
    );
    const other = stripeSigned(checkoutEvent, "whsec_someone_else");
    await expect(stripe.parseWebhook(other.payload, other.header)).rejects.toBeInstanceOf(
      BillingSignatureError,
    );
    const edited = payload.replace("cus_1", "cus_2");
    await expect(stripe.parseWebhook(edited, header)).rejects.toBeInstanceOf(BillingSignatureError);
  });

  it("refuses old signatures (replays)", async () => {
    const payload = JSON.stringify(checkoutEvent);
    const header = helper.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    });
    await expect(stripe.parseWebhook(payload, header)).rejects.toBeInstanceOf(
      BillingSignatureError,
    );
  });
});

describe("mock billing follows the same contract", () => {
  const providers: BillingProvider[] = [new MockBilling()];
  for (const provider of providers) {
    it(`${provider.name}: accepts only its own signature`, async () => {
      const body = JSON.stringify({ id: "evt_1", kind: "ignored", type: "x" });
      expect(await provider.parseWebhook(body, MockBilling.sign(body))).toMatchObject({
        id: "evt_1",
      });
      await expect(provider.parseWebhook(body, "nope")).rejects.toBeInstanceOf(
        BillingSignatureError,
      );
      await expect(
        provider.parseWebhook(`${body} `, MockBilling.sign(body)),
      ).rejects.toBeInstanceOf(BillingSignatureError);
    });
    it(`${provider.name}: hosted pages return a URL`, async () => {
      const checkout = await provider.createCheckout({
        tenantId: "t1",
        priceId: "price_1",
        successUrl: "http://localhost:3000/ok",
        cancelUrl: "http://localhost:3000/no",
      });
      expect(checkout.url).toMatch(/^https:\/\//);
      expect((await provider.createPortal({ customerId: "c", returnUrl: "x" })).url).toMatch(
        /^https:\/\//,
      );
      expect(await provider.getSubscription("missing")).toBeNull();
    });
  }
});
