import { BillingSignatureError, type BillingEvent } from "@voicedesk/adapters";
import {
  can,
  getPlanState,
  PAID_PLANS,
  PLAN_FEATURES,
  PLAN_IDS,
  PLANS,
  recordAudit,
  type PaidPlanId,
  type PlanId,
} from "@voicedesk/core";
import { stripeEvents, withPlatformAccess, withTenant } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { setPlanByPlatform, syncSubscription, toPriceMap } from "../lib/billing";
import { HttpError, notFound } from "../lib/errors";
import { requireFreshAuth } from "../lib/fresh-auth";
import { requireTenantAccess } from "./guards";
import { requirePlatformOwner } from "./platform";

/**
 * Plans and billing (ADR 0023). Payments happen on Stripe's hosted pages (Checkout and the
 * customer portal): no card details reach VoiceDesk. The server picks the Stripe Price for
 * a plan; the client only names the plan. Plan changes arrive by signed webhook.
 */

const params = z.object({ tenantId: z.string() });
const planView = z.object({
  id: z.enum(PLAN_IDS),
  name: z.string(),
  pricePence: z.number(),
  minutes: z.number(),
  texts: z.number(),
  aiPence: z.number(),
  phoneNumbers: z.number(),
  seats: z.number(),
  features: z.array(z.enum(PLAN_FEATURES)),
});
const billingView = z.object({
  plan: planView,
  status: z.enum(["trialing", "active", "past_due", "canceled"]),
  usable: z.boolean(),
  reason: z.enum(["trial_ended", "canceled", "unpaid"]).nullable(),
  comped: z.boolean(),
  trialEndsAt: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  pastDueSince: z.string().nullable(),
  /** Has a Stripe customer (the portal can open). */
  hasBillingAccount: z.boolean(),
  /** Stripe keys and prices are set up, so plans can be bought. */
  billingReady: z.boolean(),
  canManage: z.boolean(),
  plans: z.array(planView.extend({ available: z.boolean() })),
});

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const view = (id: PlanId) => {
  const p = PLANS[id];
  return { ...p, features: [...p.features] };
};

export function registerBillingRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const prices = toPriceMap(deps.billingPrices);
  const webOrigin = deps.webOrigin ?? "http://localhost:3000";
  const ready = () => Boolean(deps.billing) && PAID_PLANS.every((plan) => prices[plan]);
  const notSetUp = () => new HttpError(503, "BILLING_NOT_SET_UP", "Payments aren't set up yet.");

  r.get(
    "/api/tenants/:tenantId/billing",
    {
      schema: {
        tags: ["billing"],
        summary: "The business's plan, its status and the plans it can move to",
        params,
        response: { 200: billingView },
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "tenant:read",
      );
      const state = await getPlanState(deps.db, access.tenantId);
      const sub = state.subscription;
      return {
        plan: view(state.plan.id),
        status: state.status,
        usable: state.usable,
        reason: state.reason,
        comped: sub?.comped ?? false,
        trialEndsAt: iso(sub?.trialEndsAt),
        currentPeriodEnd: iso(sub?.currentPeriodEnd),
        cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
        pastDueSince: iso(sub?.pastDueSince),
        hasBillingAccount: Boolean(sub?.stripeCustomerId),
        billingReady: ready(),
        canManage: can(access.role, "billing:manage"),
        plans: PAID_PLANS.map((id) => ({
          ...view(id),
          available: Boolean(deps.billing && prices[id]),
        })),
      };
    },
  );

  r.post(
    "/api/tenants/:tenantId/billing/checkout",
    {
      schema: {
        tags: ["billing"],
        summary: "Start a Stripe Checkout for a plan (owners); returns the page to open",
        params,
        body: z.object({ planId: z.enum(PAID_PLANS) }),
        response: { 200: z.object({ url: z.string() }) },
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "billing:manage",
      );
      await requireFreshAuth(deps.freshAuth, access.session.session.id);
      const planId: PaidPlanId = request.body.planId;
      const priceId = prices[planId];
      if (!deps.billing || !priceId) throw notSetUp();
      const state = await getPlanState(deps.db, access.tenantId);
      const sub = state.subscription;
      // An existing subscription changes plan in the portal (prorated by Stripe), not by
      // buying a second one.
      if (sub?.stripeSubscriptionId && sub.status !== "canceled") {
        throw new HttpError(
          409,
          "USE_PORTAL",
          "You already have a subscription. Change plan with Manage billing.",
        );
      }
      const base = `${webOrigin}/t/${access.tenantId}/billing`;
      const { url } = await deps.billing.createCheckout({
        tenantId: access.tenantId,
        priceId,
        customerId: sub?.stripeCustomerId ?? null,
        customerEmail: access.session.user.email,
        successUrl: `${base}?checkout=done`,
        cancelUrl: `${base}?checkout=cancelled`,
      });
      await withTenant(deps.db, access.tenantId, (tx) =>
        recordAudit(tx, {
          tenantId: access.tenantId,
          actorType: "user",
          actorUserId: access.session.user.id,
          action: "billing.checkout_started",
          metadata: { planId },
          ipAddress: request.ip ?? null,
        }),
      );
      return { url };
    },
  );

  r.post(
    "/api/tenants/:tenantId/billing/portal",
    {
      schema: {
        tags: ["billing"],
        summary: "Open the Stripe customer portal (owners): plan, card, invoices, cancel",
        params,
        response: { 200: z.object({ url: z.string() }) },
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "billing:manage",
      );
      await requireFreshAuth(deps.freshAuth, access.session.session.id);
      if (!deps.billing) throw notSetUp();
      const state = await getPlanState(deps.db, access.tenantId);
      const customerId = state.subscription?.stripeCustomerId;
      if (!customerId) throw new HttpError(409, "NO_BILLING_ACCOUNT", "Choose a plan first.");
      return deps.billing.createPortal({
        customerId,
        returnUrl: `${webOrigin}/t/${access.tenantId}/billing`,
      });
    },
  );

  r.put(
    "/api/platform/tenants/:tenantId/plan",
    {
      schema: {
        tags: ["platform"],
        summary: "Give a business a plan free, or restart its trial",
        params: z.object({ tenantId: z.string().uuid() }),
        body: z.object({
          planId: z.enum(PLAN_IDS),
          trialDays: z.number().int().min(1).max(90).optional(),
        }),
      },
    },
    async (request) => {
      const session = await requirePlatformOwner(deps, request);
      const ok = await setPlanByPlatform(deps.db, session.user.id, {
        tenantId: request.params.tenantId,
        planId: request.body.planId,
        trialDays: request.body.trialDays,
        ipAddress: request.ip ?? null,
      });
      if (!ok) throw notFound();
      return { ok: true };
    },
  );

  // Webhook: Stripe signs the raw body, so this route parses it itself.
  void app.register((scope, _opts, done) => {
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "string", bodyLimit: 512 * 1024 },
      (_req, body, next) => next(null, body),
    );
    scope.post("/api/webhooks/stripe", async (request, reply) => {
      const billing = deps.billing;
      if (!billing) return reply.status(404).send({ error: "not found" });
      const raw = typeof request.body === "string" ? request.body : "";
      const header = request.headers["stripe-signature"];
      let event: BillingEvent;
      try {
        event = await billing.parseWebhook(raw, typeof header === "string" ? header : undefined);
      } catch (error) {
        if (error instanceof BillingSignatureError) {
          return reply.status(400).send({ error: "invalid signature" });
        }
        throw error;
      }
      const actor = { actorUserId: null, reason: "billing webhook" };
      const [seen] = await withPlatformAccess(deps.db, actor, (tx) =>
        tx.select({ id: stripeEvents.id }).from(stripeEvents).where(eq(stripeEvents.id, event.id)),
      );
      if (seen) return { received: true };

      // Handled before it's recorded, so a failure here makes Stripe retry. Handling re-reads
      // the subscription, so a retry is harmless.
      const target =
        event.kind === "checkout_completed" && event.subscriptionId
          ? {
              subscriptionId: event.subscriptionId,
              tenantId: event.tenantId,
              customerId: event.customerId,
            }
          : event.kind === "subscription_changed"
            ? { subscriptionId: event.subscriptionId, tenantId: event.tenantId }
            : null;
      if (target) {
        const result = await syncSubscription({ db: deps.db, billing, prices }, target);
        if (result.outcome === "ignored") {
          request.log.warn({ reason: result.reason }, "billing event ignored");
        }
      }
      await withPlatformAccess(deps.db, actor, (tx) =>
        tx
          .insert(stripeEvents)
          .values({ id: event.id, type: event.kind === "ignored" ? event.type : event.kind })
          .onConflictDoNothing(),
      );
      return { received: true };
    });
    done();
  });
}
