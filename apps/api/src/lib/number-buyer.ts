import type { CarrierNumbers } from "@voicedesk/adapters";
import { getNumberSettings, getPlanState, numberAllowance } from "@voicedesk/core";
import {
  numberIdentities,
  numberOrders,
  phoneNumbers,
  tenants,
  withPlatformAccess,
  type Database,
  type NumberSettings,
} from "@voicedesk/db";
import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { registerPhoneNumber } from "./phone-numbers";
import type { SipGateway } from "./sip";

/**
 * Automatic numbers (ADR 0032): checks the carrier's reviews, buys the numbers businesses
 * ordered once their review is approved (only while the platform switch is on, within the
 * daily limit), routes them, and switches off and later releases numbers when a plan ends.
 * Buying costs money; nothing else here does.
 */

/** A plan that stops paying keeps its numbers this long before they're released. */
export const RELEASE_AFTER_DAYS = 30;
const PASS_EVERY_MS = 5 * 60_000;

export interface NumberBuyerDeps {
  db: Database;
  carrier: CarrierNumbers;
  sip: SipGateway;
  /** Where the carrier sends calls (TWILIO_VOICE_URL: the TwiML Bin dialling LiveKit). */
  voiceUrl: string;
  log: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
  };
  /** Tests pass their own (the platform settings row is shared). */
  settings?: NumberSettings;
}

const system = (reason: string) => ({ actorUserId: null, reason });

export interface BuyerPass {
  reviewsChecked: number;
  bought: number;
  failed: number;
  disabled: number;
  released: number;
}

export async function processNumberOrders(
  deps: NumberBuyerDeps,
  now: Date = new Date(),
  /** Limit to these businesses (tests); by default every business. */
  only?: string[],
): Promise<BuyerPass> {
  const pass: BuyerPass = { reviewsChecked: 0, bought: 0, failed: 0, disabled: 0, released: 0 };
  const inScope = <T extends { tenantId: string }>(rows: T[]) =>
    only ? rows.filter((r) => only.includes(r.tenantId)) : rows;

  // 1. The carrier's reviews (free to check).
  const pending = inScope(
    await withPlatformAccess(deps.db, system("number reviews"), (tx) =>
      tx.select().from(numberIdentities).where(eq(numberIdentities.status, "pending")),
    ),
  );
  for (const identity of pending) {
    if (!identity.carrierIdentityId) continue;
    const result = await deps.carrier.identityStatus(identity.carrierIdentityId).catch(() => null);
    pass.reviewsChecked++;
    if (!result || result.status === "pending") continue;
    await withPlatformAccess(deps.db, system("number review result"), async (tx) => {
      await tx
        .update(numberIdentities)
        .set({ status: result.status, reason: result.reason, checkedAt: now, updatedAt: now })
        .where(eq(numberIdentities.id, identity.id));
      if (result.status === "rejected") {
        await tx
          .update(numberOrders)
          .set({ status: "failed", reason: "review_rejected", updatedAt: now })
          .where(
            and(
              eq(numberOrders.tenantId, identity.tenantId),
              eq(numberOrders.numberType, identity.numberType),
              eq(numberOrders.status, "waiting_review"),
            ),
          );
      }
    });
  }

  // 2. Buy what's ready, when the platform owner allows purchases.
  const settings = deps.settings ?? (await getNumberSettings(deps.db));
  if (settings.autoBuy) {
    const dayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
    const ready = inScope(
      await withPlatformAccess(deps.db, system("numbers to buy"), (tx) =>
        tx
          .select({ order: numberOrders, identity: numberIdentities })
          .from(numberOrders)
          .innerJoin(
            numberIdentities,
            and(
              eq(numberIdentities.tenantId, numberOrders.tenantId),
              eq(numberIdentities.numberType, numberOrders.numberType),
            ),
          )
          .where(
            and(eq(numberOrders.status, "waiting_review"), eq(numberIdentities.status, "approved")),
          ),
      ).then((rows) => rows.map((r) => ({ ...r, tenantId: r.order.tenantId }))),
    );
    for (const { order, identity } of ready) {
      const [today] = await withPlatformAccess(deps.db, system("number daily limit"), (tx) =>
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(phoneNumbers)
          .where(
            and(isNotNull(phoneNumbers.carrierNumberId), gte(phoneNumbers.createdAt, dayStart)),
          ),
      );
      if ((today?.n ?? 0) >= settings.dailyLimit) {
        deps.log.warn({ dailyLimit: settings.dailyLimit }, "daily number purchase limit reached");
        break;
      }
      const outcome = await buyOne(deps, order, identity, settings, now);
      if (outcome === "bought") pass.bought++;
      if (outcome === "failed") pass.failed++;
    }
  }

  // 3. Plans that stopped paying: numbers off now, released after RELEASE_AFTER_DAYS.
  const ours = inScope(
    await withPlatformAccess(deps.db, system("numbers on lapsed plans"), (tx) =>
      tx
        .select()
        .from(phoneNumbers)
        .where(inArray(phoneNumbers.billing, ["included", "extra"])),
    ),
  );
  for (const number of ours) {
    const state = await getPlanState(deps.db, number.tenantId, now);
    const paying = state.usable && state.plan.id !== "trial" && state.plan.id !== "demo";
    if (!paying && number.status === "active") {
      await withPlatformAccess(deps.db, system("plan ended: number off"), (tx) =>
        tx
          .update(phoneNumbers)
          .set({
            status: "disabled",
            releaseAt: new Date(now.getTime() + RELEASE_AFTER_DAYS * 86_400_000),
            updatedAt: now,
          })
          .where(eq(phoneNumbers.id, number.id)),
      );
      pass.disabled++;
    } else if (paying && number.status === "disabled" && number.releaseAt) {
      // Paying again before the release: the number comes back.
      await withPlatformAccess(deps.db, system("plan back: number on"), (tx) =>
        tx
          .update(phoneNumbers)
          .set({ status: "active", releaseAt: null, updatedAt: now })
          .where(eq(phoneNumbers.id, number.id)),
      );
    }
  }
  const due = inScope(
    await withPlatformAccess(deps.db, system("numbers to release"), (tx) =>
      tx
        .select()
        .from(phoneNumbers)
        .where(and(isNotNull(phoneNumbers.releaseAt), lte(phoneNumbers.releaseAt, now))),
    ),
  );
  for (const number of due) {
    await releaseNumber(deps, number);
    pass.released++;
  }
  return pass;
}

type OrderRow = typeof numberOrders.$inferSelect;
type IdentityRow = typeof numberIdentities.$inferSelect;

async function buyOne(
  deps: NumberBuyerDeps,
  order: OrderRow,
  identity: IdentityRow,
  settings: NumberSettings,
  now: Date,
): Promise<"bought" | "failed" | "skipped"> {
  const fail = async (reason: string) => {
    await withPlatformAccess(deps.db, system("number order failed"), (tx) =>
      tx
        .update(numberOrders)
        .set({ status: "failed", reason, updatedAt: now })
        .where(eq(numberOrders.id, order.id)),
    );
    deps.log.warn({ orderId: order.id, reason }, "number order failed");
    return "failed" as const;
  };
  // Claim it once (two API processes can't buy the same order).
  const claimed = await withPlatformAccess(deps.db, system("claim number order"), (tx) =>
    tx
      .update(numberOrders)
      .set({ status: "buying", updatedAt: now })
      .where(and(eq(numberOrders.id, order.id), eq(numberOrders.status, "waiting_review")))
      .returning({ id: numberOrders.id }),
  );
  if (!claimed.length) return "skipped";

  // Still allowed: a paid plan, within its numbers and the per-business ceiling.
  const state = await getPlanState(deps.db, order.tenantId, now);
  if (!state.usable || state.plan.id === "trial" || state.plan.id === "demo") {
    return fail("plan_not_paid");
  }
  const [count] = await withPlatformAccess(deps.db, system("number allowance"), (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.tenantId, order.tenantId), eq(phoneNumbers.status, "active"))),
  );
  const used = count?.n ?? 0;
  if (used >= numberAllowance(state).total) return fail("allowance_used");
  if (used >= settings.perBusiness) return fail("business_ceiling");
  if (!identity.carrierIdentityId || !identity.carrierAddressId) return fail("no_review");

  const [tenant] = await withPlatformAccess(deps.db, system("number country"), (tx) =>
    tx.select({ country: tenants.countryCode }).from(tenants).where(eq(tenants.id, order.tenantId)),
  );
  // The picked number, or (if someone else got it first) the nearest one still free.
  let bought: { e164: string; carrierNumberId: string } | null = null;
  const candidates = [order.e164];
  try {
    const nearby = await deps.carrier.searchAvailable({
      countryCode: tenant?.country ?? "GB",
      type: order.numberType === "mobile" ? "mobile" : "local",
      ...(order.area && /\d/.test(order.area) ? { contains: order.area } : {}),
      ...(order.area && !/\d/.test(order.area) ? { locality: order.area } : {}),
      limit: 3,
    });
    candidates.push(...nearby.map((n) => n.e164).filter((e) => e !== order.e164));
  } catch {
    // The picked number may still be free.
  }
  for (const e164 of candidates) {
    try {
      const result = await deps.carrier.buy({
        e164,
        identityId: identity.carrierIdentityId,
        addressId: identity.carrierAddressId,
        voiceUrl: deps.voiceUrl,
      });
      bought = { e164, carrierNumberId: result.carrierNumberId };
      break;
    } catch (error) {
      deps.log.warn({ orderId: order.id, err: (error as Error).message }, "number not bought");
    }
  }
  if (!bought) return fail("no_number_available");

  try {
    const row = await registerPhoneNumber({ db: deps.db, sip: deps.sip }, null, {
      e164: bought.e164,
      tenantId: order.tenantId,
      label: order.label,
      carrier: "twilio",
      bought: {
        carrierNumberId: bought.carrierNumberId,
        numberType: order.numberType === "mobile" ? "mobile" : "local",
        billing: order.kind === "extra" ? "extra" : "included",
      },
    });
    await withPlatformAccess(deps.db, system("number order bought"), (tx) =>
      tx
        .update(numberOrders)
        .set({ status: "active", e164: bought.e164, phoneNumberId: row.id, updatedAt: now })
        .where(eq(numberOrders.id, order.id)),
    );
    deps.log.info({ orderId: order.id, tenantId: order.tenantId }, "number bought and routed");
    return "bought";
  } catch (error) {
    // Couldn't route it: give the number back rather than pay for a dead line.
    await deps.carrier.release(bought.carrierNumberId).catch(() => undefined);
    deps.log.warn({ orderId: order.id, err: (error as Error).message }, "number routing failed");
    return fail("routing_failed");
  }
}

/** Stops routing a number we bought, releases it at the carrier and removes it. */
export async function releaseNumber(
  deps: Pick<NumberBuyerDeps, "db" | "carrier" | "sip">,
  number: typeof phoneNumbers.$inferSelect,
): Promise<void> {
  if (number.livekitTrunkId || number.livekitDispatchRuleId) {
    await deps.sip
      .deleteRoute({
        trunkId: number.livekitTrunkId ?? undefined,
        dispatchRuleId: number.livekitDispatchRuleId ?? undefined,
      })
      .catch(() => undefined);
  }
  if (number.carrierNumberId) await deps.carrier.release(number.carrierNumberId);
  await withPlatformAccess(deps.db, system("number released"), (tx) =>
    tx.delete(phoneNumbers).where(eq(phoneNumbers.id, number.id)),
  );
}

/** Runs a pass every few minutes. Returns a stop function. */
export function startNumberBuyer(deps: NumberBuyerDeps): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void processNumberOrders(deps)
      .then((pass) => {
        if (pass.bought || pass.failed || pass.disabled || pass.released) {
          deps.log.info(pass, "number orders processed");
        }
      })
      .catch((error: unknown) => deps.log.warn({ err: error }, "number buyer pass failed"))
      .finally(() => {
        running = false;
      });
  }, PASS_EVERY_MS);
  return () => clearInterval(timer);
}
