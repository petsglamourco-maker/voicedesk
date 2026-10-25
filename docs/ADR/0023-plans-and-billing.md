# ADR 0023 — Plans and billing (Stripe)

- **Status:** Accepted (2026-10-25)

## Context

ADR 0022 gave every business a monthly allowance from one platform setting. The owner's decision is that **the plan alone decides what a business can use**. VoiceDesk doesn't cap anything a plan covers, a business that runs out is asked to upgrade, and every plan must be profitable from measured unit costs.

Until there are paying customers, everything runs on the owner's PC (ADR 0002). So billing is built against **Stripe test mode**, which is free and needs no bank details.

## Decision

### The plan catalogue

The catalogue lives in code: `packages/core/src/plans.ts`. It is versioned with the app, and changes to it are reviewed like any other code. Prices are monthly, in GBP, excluding VAT:

| Plan                          | Price | Minutes | Texts | AI  | Numbers | Seats | WhatsApp, VA console, feedback, daily brief, AI calls |
| ----------------------------- | ----- | ------- | ----- | --- | ------- | ----- | ----------------------------------------------------- |
| Free trial (14 days, no card) | £0    | 20      | 10    | £1  | 1       | 3     | yes                                                   |
| Starter                       | £29   | 100     | 60    | £4  | 1       | 3     | no                                                    |
| Growth                        | £79   | 350     | 200   | £10 | 1       | 8     | yes                                                   |
| Pro                           | £219  | 1,000   | 600   | £25 | 2       | 25    | yes                                                   |

**Unit costs** (October 2026 list prices; update them from real bills):

- about 6p per phone minute, fully loaded (speech-to-text, voice, LiveKit, carrier and AI);
- about 5p per UK text;
- about 2p per AI chat;
- about £1.20 per number per month;
- Stripe's 1.5% + 20p per payment.

**Cost if the whole allowance is used:** Starter £13.90, Growth £41.20, Pro £116. That leaves a gross margin of about **45–50%** after Stripe fees, before a hosting share of about £15 a month. Real use is usually below the allowance, so real margins are higher.

The trial gets every feature, so a new business can try everything. Its small allowances keep the cost to about £3.

### Allowances and limits

- **Allowances:** `allowanceFor()` (`agent-brain/src/spend.ts`) now reads the plan, which is the one change ADR 0022 planned for.
  - Minutes and texts become pence using the platform cost estimates: minutes × (voice + inbound carrier rate), and texts × the per-text rate.
  - A plan that isn't usable (trial ended, cancelled, or unpaid past the grace period) has a zero allowance. The assistant then takes messages, and data is never locked.
  - `platform_settings.maxCapPence` is no longer used, and its inputs were removed from Platform admin.
- **Feature gates:** `requireFeature()` and `PlanLimitError` (the API answers 402 with `PLAN_FEATURE` / `PLAN_LIMIT` / `PLAN_INACTIVE`) are checked when:
  - a WhatsApp number is connected;
  - a VA is assigned or "Answers calls" is turned on;
  - AI callbacks or confirmation calls are switched on;
  - a phone number is added or moved in (`requireNumberSlot`);
  - someone is invited beyond the plan's seats, counting pending invitations (`requireSeat`, in the Better Auth proxy).
- **Runtime checks:** the daily brief, feedback surveys and the AI dialler also check the plan when they run, so a downgrade takes effect without anyone changing settings.

### Data

- **`subscriptions`** has one row per business (the tenant id is the key):
  - plan, status (`trialing | active | past_due | canceled`), comped, trial end, period end, cancel-at-period-end, past-due-since, and the Stripe customer and subscription ids.
  - Forced RLS: a business can read its own row and can only insert its own trial row (`plan_id='trial'`, not comped, no Stripe ids). Every other write goes through the `voicedesk_platform` login (ADR 0022 / M11).
  - New businesses get their trial row in `createTenantProfile`. Businesses that existed before the migration were given Pro, comped.
- **`stripe_events`** is platform-only and append-only. It records which webhook events were handled.

### Stripe

- **Adapter:** `BillingProvider` in `@voicedesk/adapters` (stripe 23.0.0, API `2026-09-30.endive`) has a `MockBilling` and offline contract tests (signed with Stripe's test-header helper). Operations:
  - create a Checkout session (subscription mode; the tenant id goes in `client_reference_id` and the subscription metadata);
  - create a customer portal session;
  - verify a webhook;
  - fetch a subscription.
- **Checkout:**
  - The client names a plan, and the server picks its Price from `.env` (`STRIPE_PRICE_*`).
  - Only owners (`billing:manage`) can buy, after the password re-check.
  - A business with a live subscription changes plan in the portal (Stripe prorates), never through a second checkout.
- **Webhook** (`/api/webhooks/stripe`, raw body):
  - The signature is verified (with Stripe's 5-minute tolerance against replays), and handled event ids are skipped.
  - Each event only says which subscription changed. The server then **fetches that subscription's latest state** from Stripe, so retries and out-of-order events always end in the current state.
  - The event id is recorded after handling, so a failure makes Stripe retry.
  - **Refused:**
    - unknown prices;
    - a tenant id that doesn't match the subscription's metadata;
    - a customer id that differs from the one already linked;
    - an older subscription ending while a newer one is live.
  - Writes are audited as `system` (`billing.plan_changed`).
- **Status mapping:**
  - `active` / `trialing` → active;
  - `past_due` / `unpaid` → past_due (grace starts at the first failure);
  - `canceled` / `incomplete_expired` / `paused` → canceled;
  - `incomplete` → no change.
- **Failed payments:** past due keeps the plan working for 7 days (`PAST_DUE_GRACE_DAYS`) with a banner. After that the plan isn't usable until it's paid.
- **Payments security (SECURITY.md §10):**
  - card details only on Stripe's hosted pages;
  - server-side prices;
  - signed and deduplicated webhooks;
  - Stripe keys only in `.env`;
  - `pnpm billing:prices` refuses live keys.

### Screens

- **Plan & billing** (`/t/:id/billing`, owners and admins see it; only owners change it) shows:
  - the current plan and its status;
  - the allowances;
  - plan cards with Choose / Change;
  - Manage billing (the Stripe portal).
- **Banners:** in the last 3 days of the trial; when the trial ends, the plan is cancelled or payment is overdue; and when the AI allowance is used up ("upgrade your plan"). Spend alert emails link to Plan & billing.
- **Platform admin → Spending & limits** shows each business's plan. The owner can give a plan free (comp) or restart a trial (audited: `billing.plan_set`).

### Local testing

1. `STRIPE_SECRET_KEY` (test key).
2. `pnpm billing:prices` creates the products and prices; it can be run again safely.
3. `pnpm billing:listen` runs the Stripe CLI, which forwards webhooks to the local API and prints the `STRIPE_WEBHOOK_SECRET` to use.
4. Pay with test card 4242 4242 4242 4242.

## Alternatives

- **Plans in the database, edited in Platform admin.** Rejected for now: prices and limits are part of the product and need reviewing, and a code catalogue keeps Stripe prices, gates and tests in step. This can move to the database when plans need editing without a deploy.
- **Trusting webhook payloads directly.** Rejected: events can arrive out of order. Fetching the latest subscription is simpler and correct.
- **Metered (usage-based) billing.** Rejected for launch: fixed plans are easier to understand and keep costs predictable. Overage charging could come later.

## Consequences

- Allowances follow the plan automatically, and an upgrade takes effect as soon as Stripe confirms it.
- Production needs live keys, a live webhook endpoint (the public domain), VAT settings in Stripe Tax and the portal set up for plan switching. All of these are on the launch list.
- Changing a price means a new Stripe Price. `billing:prices` moves the lookup key to the new price; existing subscribers stay on their old price until it's migrated in Stripe.
