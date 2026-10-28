/**
 * Creates the paid plans in Stripe test mode, in every currency (ADR 0031), and prints the
 * STRIPE_PRICE_* lines for .env. Safe to run again. Usage: pnpm billing:prices
 */
import { ensureStripePrices } from "@voicedesk/adapters/billing/stripe";
import { loadRootEnv } from "@voicedesk/config/load-env";
import { CURRENCIES, PAID_PLANS, PLANS, planPrice } from "@voicedesk/core";

loadRootEnv();
const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Put your Stripe test secret key in .env as STRIPE_SECRET_KEY first.");
  process.exit(1);
}
const entries = PAID_PLANS.flatMap((id) =>
  CURRENCIES.map((currency) => ({
    id,
    key: currency === "GBP" ? id : `${id}_${currency.toLowerCase()}`,
    name: PLANS[id].name,
    amount: planPrice(id, currency),
    currency: currency.toLowerCase(),
  })),
);
const prices = await ensureStripePrices(key, entries);
console.log("Add these lines to .env, then restart VoiceDesk:\n");
for (const entry of entries) {
  console.log(`STRIPE_PRICE_${entry.key.toUpperCase()}=${prices[entry.key]}`);
}
