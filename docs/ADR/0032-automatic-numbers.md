# ADR 0032 — Automatic phone numbers and paid extra numbers

- **Status:** Accepted (2026-10-28)

## Context

A business that bought a plan got no number until the platform owner bought one in the Twilio console and registered it in Platform admin. The owner wants businesses on a paid plan to pick a number in the app and have it set up for them. Extra numbers should be a paid monthly add-on, at £5 for a local number and £8 for a mobile.

Twilio's Regulations API, checked live for GB local, mobile and toll-free numbers, says a business needs one review, a regulatory bundle:

- business name, registration identifier and number, website;
- a contact's first and last name, phone and email;
- `business_identity` and `is_subassigned`;
- a business address, held as a Twilio Address resource, with no file upload.

Further numbers reuse the approved bundle. Twilio's monthly prices are £0.87 (local), £1.89 (mobile) and £2.04 (toll-free).

## Decision

- **Adapter:** `CarrierNumbers` in `@voicedesk/adapters` (`searchAvailable`, `submitIdentity`, `identityStatus`, `buy`, `release`).
  - `TwilioNumbers` uses raw REST with Basic auth.
  - **Area-code search is anchored at the start of the number:** "023 8" becomes `Contains=+44238*`. A plain "023" matched those digits anywhere.
  - **Submitting creates:** an Address, an EndUser (business: we are `isv_reseller_or_partner`, `is_subassigned=YES`), a `business_address` supporting document, and a Bundle with the regulation sid and item assignments. It is then submitted as `pending-review`.
  - **Buying** passes the bundle sid, the address sid and `VoiceUrl = TWILIO_VOICE_URL`.
  - There is a mock and a contract test. The Telnyx implementation waits for its account.
- **Routing:** one TwiML Bin dialling `sip:{{To}}@<livekit-sip-host>` with the SIP login serves every bought number. `registerPhoneNumber` builds the LiveKit route as before, and now records `carrier_number_id`, `number_type` and `billing` (`included`, `extra`, or `manual` for numbers registered by hand).
- **Data:** `number_identities` (one per business and number type; the submitted details are personal data, never logged) and `number_orders`, both tenant tables under RLS. `subscriptions.extra_numbers` is synced from Stripe. `platform_settings.numbers` holds `{ autoBuy (off), dailyLimit (5), perBusiness (10) }`.
- **Allowance:** `requireNumberSlot` uses the plan's numbers plus the paid extras (`numberAllowance`). Automatic numbers need a usable paid plan (`requirePaidPlan`); trials and demos can't buy.
- **Billing:**
  - `NUMBER_PRICES` (£5 / €6 / $7 / CA$9 / A$10 / NZ$11 local; £8 / €9 / $11 / CA$14 / A$15 / NZ$17 mobile) become Stripe add-on prices `STRIPE_PRICE_NUMBER_LOCAL|MOBILE[_CUR]`.
  - `BillingProvider.setAddOnQuantity` adds, updates or removes the line, with proration.
  - An extra number goes on the bill **before** it's ordered, and the order requires the password re-check.
  - Cancelling an order or giving up a number sets the quantity to what's still in use.
  - The webhook finds the plan line among all the lines and reads the add-on quantities.
- **The buyer** (`apps/api/src/lib/number-buyer.ts`, every 5 minutes in the API, next to the dialler):
  - polls pending reviews (free); a rejection fails that business's waiting orders;
  - **only while `autoBuy` is on** and under the daily limit, it claims each approved order with a conditional update, re-checks the paid plan, the allowance and the per-business ceiling, and buys the picked number or the nearest free one in the same area;
  - it routes the number. If routing fails, the number is released at once rather than paid for unused.
  - When a plan stops paying, its numbers are switched off and released 30 days later. Paying again in that window turns them back on.
- **UI:**
  - **Phone numbers** (`/t/[tenantId]/numbers`, linked under Settings): the allowance, numbers and orders; the details form for the review; search and pick; add an extra number; give a number up.
  - **Platform admin → Phone numbers:** the purchase switch, the limits and the latest orders.
  - **Setup status:** an "Automatic numbers" line.

## Consequences

- A business gets its number within minutes of Twilio's approval, which usually takes 1–3 working days.
- Spending is capped by the switch, the daily limit, the per-business ceiling and paid plans only. Extras are billed before purchase.
- Failed orders show their reason on the business's screen and in Platform admin. Email alerts for failures are not built yet.
- Porting existing numbers (moving a number to us) is a separate feature, waiting for Telnyx. Forwarding remains the way to keep a number today.
