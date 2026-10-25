/**
 * Creates the paid plans in Stripe test mode and prints the STRIPE_PRICE_* lines for .env.
 * Safe to run again. Usage: pnpm billing:prices
 */
import { ensureStripePrices } from "@voicedesk/adapters/billing/stripe";
import { loadRootEnv } from "@voicedesk/config/load-env";
import { PAID_PLANS, PLANS } from "@voicedesk/core";

loadRootEnv();
const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Put your Stripe test secret key in .env as STRIPE_SECRET_KEY first.");
  process.exit(1);
}
const prices = await ensureStripePrices(
  key,
  PAID_PLANS.map((id) => PLANS[id]),
);
console.log("Add these lines to .env, then restart VoiceDesk:\n");
for (const id of PAID_PLANS) console.log(`STRIPE_PRICE_${id.toUpperCase()}=${prices[id]}`);
