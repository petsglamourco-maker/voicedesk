import Stripe from "stripe";
import {
  BillingSignatureError,
  type BillingEvent,
  type BillingProvider,
  type BillingSubscription,
} from "./types";

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

const idOf = (value: string | { id: string } | null | undefined): string | null =>
  value == null ? null : typeof value === "string" ? value : value.id;

/** Stripe Billing (stripe 23.0.0, API 2026-09-30.endive). Test keys work the same way. */
export class StripeBilling implements BillingProvider {
  readonly name = "stripe";
  private readonly stripe: Stripe;

  constructor(
    private readonly opts: { secretKey: string; webhookSecret: string; timeoutMs?: number },
  ) {
    this.stripe = new Stripe(opts.secretKey, {
      timeout: opts.timeoutMs ?? 15_000,
      maxNetworkRetries: 2,
      appInfo: { name: "VoiceDesk" },
    });
  }

  async createCheckout(params: Parameters<BillingProvider["createCheckout"]>[0]) {
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: params.priceId, quantity: 1 }],
      client_reference_id: params.tenantId,
      ...(params.customerId
        ? { customer: params.customerId }
        : params.customerEmail
          ? { customer_email: params.customerEmail }
          : {}),
      subscription_data: { metadata: { tenantId: params.tenantId } },
      metadata: { tenantId: params.tenantId },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      allow_promotion_codes: true,
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
    });
    if (!session.url) throw new Error("Stripe returned no checkout URL");
    return { url: session.url };
  }

  async createPortal(params: { customerId: string; returnUrl: string }) {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: params.customerId,
      return_url: params.returnUrl,
    });
    return { url: session.url };
  }

  async parseWebhook(rawBody: string, signature: string | undefined): Promise<BillingEvent> {
    if (!signature) throw new BillingSignatureError();
    let event: Stripe.Event;
    try {
      event = await this.stripe.webhooks.constructEventAsync(
        rawBody,
        signature,
        this.opts.webhookSecret,
      );
    } catch {
      throw new BillingSignatureError();
    }
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.mode !== "subscription")
        return { id: event.id, kind: "ignored", type: event.type };
      return {
        id: event.id,
        kind: "checkout_completed",
        tenantId: session.client_reference_id ?? session.metadata?.tenantId ?? null,
        customerId: idOf(session.customer),
        subscriptionId: idOf(session.subscription),
      };
    }
    if (SUBSCRIPTION_EVENTS.has(event.type)) {
      const sub = event.data.object as Stripe.Subscription;
      return {
        id: event.id,
        kind: "subscription_changed",
        subscriptionId: sub.id,
        tenantId: sub.metadata?.tenantId ?? null,
      };
    }
    return { id: event.id, kind: "ignored", type: event.type };
  }

  async getSubscription(subscriptionId: string): Promise<BillingSubscription | null> {
    try {
      const sub = await this.stripe.subscriptions.retrieve(subscriptionId);
      const item = sub.items.data[0];
      return {
        id: sub.id,
        customerId: idOf(sub.customer) ?? "",
        tenantId: sub.metadata?.tenantId ?? null,
        priceId: item?.price.id ?? null,
        status: sub.status,
        currentPeriodEnd: item ? new Date(item.current_period_end * 1000) : null,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      };
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }
}

/**
 * Creates (or finds) one product and monthly GBP price per plan, keyed by a lookup key so it
 * can be run again safely. For `pnpm billing:prices`; refuses live keys.
 */
export async function ensureStripePrices(
  secretKey: string,
  plans: Array<{ id: string; name: string; pricePence: number }>,
): Promise<Record<string, string>> {
  if (!/^(sk|rk)_test_/.test(secretKey)) {
    throw new Error("Use a Stripe test key (sk_test_...). Live prices are set up at launch.");
  }
  const stripe = new Stripe(secretKey, { timeout: 15_000 });
  const keyFor = (id: string) => `voicedesk_${id}_monthly_v1`;
  const existing = await stripe.prices.list({
    lookup_keys: plans.map((p) => keyFor(p.id)),
    active: true,
  });
  const found = new Map(existing.data.map((price) => [price.lookup_key, price]));
  const result: Record<string, string> = {};
  for (const plan of plans) {
    const have = found.get(keyFor(plan.id));
    if (have && have.unit_amount === plan.pricePence && have.currency === "gbp") {
      result[plan.id] = have.id;
      continue;
    }
    const product = await stripe.products.create({
      name: `VoiceDesk ${plan.name}`,
      metadata: { planId: plan.id },
    });
    const price = await stripe.prices.create({
      product: product.id,
      currency: "gbp",
      unit_amount: plan.pricePence,
      recurring: { interval: "month" },
      tax_behavior: "exclusive",
      lookup_key: keyFor(plan.id),
      // A changed price takes the lookup key from the old one.
      transfer_lookup_key: true,
      metadata: { planId: plan.id },
    });
    result[plan.id] = price.id;
  }
  return result;
}
