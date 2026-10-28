import { findCountryConfig } from "@voicedesk/compliance";
import {
  getNumberSettings,
  getPlanState,
  NUMBER_PRICES,
  numberAllowance,
  requirePaidPlan,
  saveNumberSettings,
} from "@voicedesk/core";
import {
  numberIdentities,
  numberOrders,
  phoneNumbers,
  tenants,
  withPlatformAccess,
  withTenant,
} from "@voicedesk/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { numberPriceIdFor, syncSubscription, toPriceMap } from "../lib/billing";
import { HttpError, notFound } from "../lib/errors";
import { requireFreshAuth } from "../lib/fresh-auth";
import { releaseNumber } from "../lib/number-buyer";
import { requireTenantAccess } from "./guards";
import { requirePlatformOwner } from "./platform";

/**
 * Automatic phone numbers (ADR 0032). A business on a paid plan submits its details for the
 * carrier's review once, picks numbers, and the API's number buyer buys and routes them.
 * Extra numbers are a paid add-on on the same Stripe subscription.
 */

const numberType = z.enum(["local", "mobile"]);
const ACTIVE_ORDERS = ["waiting_review", "buying"];

const identityBody = z.object({
  type: numberType,
  businessName: z.string().trim().min(2).max(120),
  registrationIdentifier: z.string().trim().min(2).max(60).default("Companies House"),
  registrationNumber: z.string().trim().min(2).max(40),
  website: z.string().trim().url().max(200),
  contactFirstName: z.string().trim().min(1).max(60),
  contactLastName: z.string().trim().min(1).max(60),
  contactEmail: z.string().trim().email().max(200),
  contactPhone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, "International format, e.g. +447700900123"),
  address: z.object({
    street: z.string().trim().min(2).max(120),
    city: z.string().trim().min(2).max(60),
    region: z.string().trim().max(60).default(""),
    postalCode: z.string().trim().min(2).max(12),
  }),
});

export function registerNumberRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["numbers"];
  const params = z.object({ tenantId: z.string() });
  const prices = toPriceMap(deps.billingPrices);

  const carrier = () => {
    if (!deps.carrierNumbers) {
      throw new HttpError(503, "NUMBERS_NOT_SET_UP", "Getting numbers isn't set up yet");
    }
    return deps.carrierNumbers;
  };
  const countryOf = async (tenantId: string) => {
    const [row] = await withTenant(deps.db, tenantId, (tx) =>
      tx.select({ country: tenants.countryCode }).from(tenants).where(eq(tenants.id, tenantId)),
    );
    const country = row?.country ?? "GB";
    return { country, currency: (findCountryConfig(country)?.currency ?? "GBP") };
  };
  const manage = async (request: FastifyRequest, tenantId: string, spends: boolean) => {
    const access = await requireTenantAccess(deps, request, tenantId, "billing:manage");
    if (spends) await requireFreshAuth(deps.freshAuth, access.session.session.id);
    return access;
  };

  /** Sets the Stripe add-on to the extra numbers in use or ordered, then re-syncs. */
  async function setExtras(tenantId: string, type: "local" | "mobile", quantity: number) {
    const state = await getPlanState(deps.db, tenantId);
    const sub = state.subscription;
    const { currency } = await countryOf(tenantId);
    const priceId = numberPriceIdFor(prices, type, currency);
    if (!deps.billing || !sub?.stripeSubscriptionId || !priceId) {
      throw new HttpError(503, "BILLING_NOT_SET_UP", "Extra numbers can't be bought yet.");
    }
    await deps.billing.setAddOnQuantity(sub.stripeSubscriptionId, priceId, quantity);
    await syncSubscription(
      { db: deps.db, billing: deps.billing, prices },
      { subscriptionId: sub.stripeSubscriptionId, tenantId },
    );
  }

  async function extrasInUse(tenantId: string, type: "local" | "mobile"): Promise<number> {
    return withTenant(deps.db, tenantId, async (tx) => {
      const numbers = await tx
        .select({ id: phoneNumbers.id })
        .from(phoneNumbers)
        .where(
          and(
            eq(phoneNumbers.tenantId, tenantId),
            eq(phoneNumbers.billing, "extra"),
            eq(phoneNumbers.numberType, type),
          ),
        );
      const orders = await tx
        .select({ id: numberOrders.id })
        .from(numberOrders)
        .where(
          and(
            eq(numberOrders.tenantId, tenantId),
            eq(numberOrders.kind, "extra"),
            eq(numberOrders.numberType, type),
            inArray(numberOrders.status, ACTIVE_ORDERS),
          ),
        );
      return numbers.length + orders.length;
    });
  }

  r.get(
    "/api/tenants/:tenantId/numbers",
    {
      schema: {
        tags,
        summary: "The business's numbers, allowance, carrier review and orders",
        params,
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
      const { country, currency } = await countryOf(access.tenantId);
      const data = await withTenant(deps.db, access.tenantId, async (tx) => ({
        numbers: await tx
          .select({
            id: phoneNumbers.id,
            e164: phoneNumbers.e164,
            label: phoneNumbers.label,
            status: phoneNumbers.status,
            billing: phoneNumbers.billing,
            numberType: phoneNumbers.numberType,
            releaseAt: phoneNumbers.releaseAt,
          })
          .from(phoneNumbers)
          .where(eq(phoneNumbers.tenantId, access.tenantId)),
        identities: await tx
          .select({
            numberType: numberIdentities.numberType,
            status: numberIdentities.status,
            reason: numberIdentities.reason,
            businessName: numberIdentities.details,
          })
          .from(numberIdentities)
          .where(eq(numberIdentities.tenantId, access.tenantId)),
        orders: await tx
          .select()
          .from(numberOrders)
          .where(eq(numberOrders.tenantId, access.tenantId))
          .orderBy(desc(numberOrders.createdAt))
          .limit(20),
      }));
      const allowance = numberAllowance(state);
      return {
        country,
        currency,
        paidPlan: state.usable && state.plan.id !== "trial" && state.plan.id !== "demo",
        available: Boolean(deps.carrierNumbers),
        allowance: {
          ...allowance,
          used: data.numbers.filter((n) => n.status === "active").length,
        },
        prices: { local: NUMBER_PRICES.local[currency], mobile: NUMBER_PRICES.mobile[currency] },
        numbers: data.numbers,
        identities: data.identities.map((i) => ({
          numberType: i.numberType,
          status: i.status,
          reason: i.reason,
          businessName: String((i.businessName as { businessName?: string }).businessName ?? ""),
        })),
        orders: data.orders.map((o) => ({
          id: o.id,
          numberType: o.numberType,
          kind: o.kind,
          e164: o.e164,
          status: o.status,
          reason: o.reason,
          createdAt: o.createdAt,
        })),
      };
    },
  );

  r.post(
    "/api/tenants/:tenantId/numbers/identity",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
      schema: {
        tags,
        summary: "Send the business's details for the carrier's review (once per number type)",
        params,
        body: identityBody,
      },
    },
    async (request, reply) => {
      const access = await manage(request, request.params.tenantId, false);
      await requirePaidPlan(deps.db, access.tenantId);
      const { country } = await countryOf(access.tenantId);
      const [existing] = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .select()
          .from(numberIdentities)
          .where(
            and(
              eq(numberIdentities.tenantId, access.tenantId),
              eq(numberIdentities.numberType, request.body.type),
            ),
          ),
      );
      if (existing && existing.status !== "rejected") {
        throw new HttpError(409, "ALREADY_SUBMITTED", "Your details are already with the carrier");
      }
      const { type, ...details } = request.body;
      const identity = await carrier().submitIdentity({ ...details, type, countryCode: country });
      const values = {
        tenantId: access.tenantId,
        numberType: type,
        carrier: "twilio",
        carrierIdentityId: identity.id,
        carrierAddressId: identity.addressId,
        status: identity.status,
        reason: null,
        details,
        updatedAt: new Date(),
      };
      await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .insert(numberIdentities)
          .values(values)
          .onConflictDoUpdate({
            target: [numberIdentities.tenantId, numberIdentities.numberType],
            set: values,
          }),
      );
      return reply.status(201).send({ status: identity.status });
    },
  );

  r.get(
    "/api/tenants/:tenantId/numbers/search",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        tags,
        summary: "Numbers available now (by area code or town)",
        params,
        querystring: z.object({
          type: numberType.default("local"),
          area: z.string().trim().max(40).optional(),
        }),
      },
    },
    async (request) => {
      const access = await manage(request, request.params.tenantId, false);
      await requirePaidPlan(deps.db, access.tenantId);
      const { country } = await countryOf(access.tenantId);
      const area = request.query.area;
      const results = await carrier().searchAvailable({
        countryCode: country,
        type: request.query.type,
        ...(area && /\d/.test(area) ? { contains: area } : {}),
        ...(area && !/\d/.test(area) ? { locality: area } : {}),
        limit: 10,
      });
      return { numbers: results };
    },
  );

  r.post(
    "/api/tenants/:tenantId/numbers/orders",
    {
      schema: {
        tags,
        summary:
          "Order a number (included in the plan, or a paid extra); it's bought once the review is approved",
        params,
        body: z.object({
          type: numberType,
          e164: z.string().regex(/^\+[1-9]\d{7,14}$/),
          area: z.string().trim().max(40).optional(),
          label: z.string().trim().max(60).optional(),
          kind: z.enum(["included", "extra"]),
        }),
      },
    },
    async (request, reply) => {
      const access = await manage(request, request.params.tenantId, request.body.kind === "extra");
      const state = await requirePaidPlan(deps.db, access.tenantId);
      const settings = deps.numberSettings ?? (await getNumberSettings(deps.db));
      const { type, kind } = request.body;
      const [identity] = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .select({ status: numberIdentities.status })
          .from(numberIdentities)
          .where(
            and(
              eq(numberIdentities.tenantId, access.tenantId),
              eq(numberIdentities.numberType, type),
            ),
          ),
      );
      if (!identity || identity.status === "rejected") {
        throw new HttpError(
          409,
          "DETAILS_NEEDED",
          "Send your business details for the carrier's review first",
        );
      }
      const counts = await withTenant(deps.db, access.tenantId, async (tx) => ({
        numbers: await tx
          .select({ billing: phoneNumbers.billing })
          .from(phoneNumbers)
          .where(
            and(eq(phoneNumbers.tenantId, access.tenantId), eq(phoneNumbers.status, "active")),
          ),
        orders: await tx
          .select({ kind: numberOrders.kind })
          .from(numberOrders)
          .where(
            and(
              eq(numberOrders.tenantId, access.tenantId),
              inArray(numberOrders.status, ACTIVE_ORDERS),
            ),
          ),
      }));
      const total = counts.numbers.length + counts.orders.length;
      if (total >= settings.perBusiness) {
        throw new HttpError(
          409,
          "TOO_MANY_NUMBERS",
          `A business can have up to ${settings.perBusiness} numbers`,
        );
      }
      if (kind === "included") {
        const usedIncluded =
          counts.numbers.filter((n) => n.billing !== "extra").length +
          counts.orders.filter((o) => o.kind === "included").length;
        if (usedIncluded >= state.plan.phoneNumbers) {
          throw new HttpError(
            409,
            "INCLUDED_USED",
            "Your plan's numbers are in use. Add an extra number instead.",
          );
        }
      } else {
        // The extra number goes on the bill first; it's bought once Stripe has it.
        await setExtras(access.tenantId, type, (await extrasInUse(access.tenantId, type)) + 1);
      }
      const [order] = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .insert(numberOrders)
          .values({
            tenantId: access.tenantId,
            numberType: type,
            kind,
            e164: request.body.e164,
            area: request.body.area ?? null,
            label: request.body.label ?? null,
          })
          .returning({ id: numberOrders.id, status: numberOrders.status }),
      );
      return reply.status(201).send(order);
    },
  );

  r.delete(
    "/api/tenants/:tenantId/numbers/orders/:orderId",
    {
      schema: {
        tags,
        summary: "Cancel a number that hasn't been bought yet",
        params: params.extend({ orderId: z.string().uuid() }),
      },
    },
    async (request, reply) => {
      const access = await manage(request, request.params.tenantId, false);
      const [order] = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .update(numberOrders)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(
            and(
              eq(numberOrders.id, request.params.orderId),
              eq(numberOrders.tenantId, access.tenantId),
              eq(numberOrders.status, "waiting_review"),
            ),
          )
          .returning(),
      );
      if (!order) throw notFound();
      if (order.kind === "extra") {
        const type = order.numberType === "mobile" ? "mobile" : "local";
        await setExtras(access.tenantId, type, await extrasInUse(access.tenantId, type));
      }
      return reply.status(204).send();
    },
  );

  r.delete(
    "/api/tenants/:tenantId/numbers/:numberId",
    {
      schema: {
        tags,
        summary: "Give up a number we bought for the business (it can't be recovered)",
        params: params.extend({ numberId: z.string().uuid() }),
      },
    },
    async (request, reply) => {
      const access = await manage(request, request.params.tenantId, true);
      const [number] = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .select()
          .from(phoneNumbers)
          .where(
            and(
              eq(phoneNumbers.id, request.params.numberId),
              eq(phoneNumbers.tenantId, access.tenantId),
            ),
          ),
      );
      if (!number || !number.carrierNumberId) throw notFound();
      if (!deps.sip)
        throw new HttpError(503, "SIP_NOT_CONFIGURED", "Calls aren't set up on this server");
      await releaseNumber({ db: deps.db, carrier: carrier(), sip: deps.sip }, number);
      if (number.billing === "extra") {
        const type = number.numberType === "mobile" ? "mobile" : "local";
        await setExtras(access.tenantId, type, await extrasInUse(access.tenantId, type));
      }
      return reply.status(204).send();
    },
  );

  // ── Platform admin ────────────────────────────────────────────────────────────────────

  r.get(
    "/api/platform/number-purchases",
    {
      schema: {
        tags: ["platform"],
        summary: "Automatic number purchases: the switch, limits and open orders",
      },
    },
    async (request) => {
      const session = await requirePlatformOwner(deps, request);
      const settings = await getNumberSettings(deps.db);
      const orders = await withPlatformAccess(
        deps.db,
        { actorUserId: session.user.id, reason: "number orders" },
        (tx) =>
          tx
            .select({ order: numberOrders, business: tenants.name })
            .from(numberOrders)
            .innerJoin(tenants, eq(tenants.id, numberOrders.tenantId))
            .orderBy(desc(numberOrders.createdAt))
            .limit(50),
      );
      return {
        settings,
        available: Boolean(deps.carrierNumbers),
        orders: orders.map(({ order, business }) => ({
          id: order.id,
          business,
          e164: order.e164,
          numberType: order.numberType,
          kind: order.kind,
          status: order.status,
          reason: order.reason,
          createdAt: order.createdAt,
        })),
      };
    },
  );

  r.put(
    "/api/platform/number-purchases",
    {
      schema: {
        tags: ["platform"],
        summary: "Switch automatic number purchases on or off and set the limits",
        body: z.object({
          autoBuy: z.boolean(),
          dailyLimit: z.number().int().min(1).max(100),
          perBusiness: z.number().int().min(1).max(50),
        }),
      },
    },
    async (request, reply) => {
      const session = await requirePlatformOwner(deps, request);
      await saveNumberSettings(deps.db, request.body, session.user.id);
      return reply.status(204).send();
    },
  );
}
