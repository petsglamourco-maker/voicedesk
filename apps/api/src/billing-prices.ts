/**
 * Creates the paid plans in Stripe test mode, in every currency (ADR 0031), and prints the
 * STRIPE_PRICE_* lines for .env. Safe to run again. Usage: pnpm billing:prices
 */
import { ensureStripePrices } from "@voicedesk/adapters/billing/stripe";
import { loadRootEnv } from "@voicedesk/config/load-env";
import { CURRENCIES, NUMBER_PRICES, PAID_PLANS, PLANS, planPrice } from "@voicedesk/core";

loadRootEnv();
const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Put your Stripe test secret key in .env as STRIPE_SECRET_KEY first.");
  process.exit(1);
}
const entries: Array<{ id: string; key: string; name: string; amount: number; currency: string }> =
  PAID_PLANS.flatMap((id) =>
    CURRENCIES.map((currency) => ({
      id,
      key: currency === "GBP" ? id : `${id}_${currency.toLowerCase()}`,
      name: PLANS[id].name,
      amount: planPrice(id, currency),
      currency: currency.toLowerCase(),
    })),
  );
// ADR 0032: extra phone numbers, added to a subscription as their own monthly line.
for (const type of ["local", "mobile"] as const) {
  for (const currency of CURRENCIES) {
    entries.push({
      id: `number_${type}`,
      key: currency === "GBP" ? `number_${type}` : `number_${type}_${currency.toLowerCase()}`,
      name: type === "local" ? "Extra local number" : "Extra mobile number",
      amount: NUMBER_PRICES[type][currency],
      currency: currency.toLowerCase(),
    });
  }
}
const prices = await ensureStripePrices(key, entries);
console.log("Add these lines to .env, then restart VoiceDesk:\n");
for (const entry of entries) {
  console.log(`STRIPE_PRICE_${entry.key.toUpperCase()}=${prices[entry.key]}`);
}
