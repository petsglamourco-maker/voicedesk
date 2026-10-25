/**
 * Subscription billing (ADR 0023). Payment pages are hosted by the provider (Checkout and
 * the customer portal), so card details never reach VoiceDesk. Webhook events are verified
 * against the raw body and reduced to what the platform needs; the caller then fetches the
 * subscription's latest state, so events arriving out of order can't roll a plan back.
 */
export interface BillingProvider {
  readonly name: string;
  /** A hosted checkout page for a new subscription to one price. */
  createCheckout(params: {
    tenantId: string;
    priceId: string;
    /** Reuse the business's existing customer when there is one. */
    customerId?: string | null;
    customerEmail?: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;
  /** The hosted portal: change plan, update the card, see invoices, cancel. */
  createPortal(params: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  /** Verifies the signature; throws BillingSignatureError when it doesn't match. */
  parseWebhook(rawBody: string, signature: string | undefined): Promise<BillingEvent>;
  getSubscription(subscriptionId: string): Promise<BillingSubscription | null>;
}

export interface BillingSubscription {
  id: string;
  customerId: string;
  /** Set by our checkout (subscription metadata). */
  tenantId: string | null;
  priceId: string | null;
  /** Stripe's status: trialing, active, past_due, canceled, unpaid, incomplete, paused… */
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export type BillingEvent =
  | {
      id: string;
      kind: "checkout_completed";
      tenantId: string | null;
      customerId: string | null;
      subscriptionId: string | null;
    }
  | { id: string; kind: "subscription_changed"; subscriptionId: string; tenantId: string | null }
  | { id: string; kind: "ignored"; type: string };

export class BillingSignatureError extends Error {
  constructor() {
    super("Webhook signature doesn't match");
    this.name = "BillingSignatureError";
  }
}
