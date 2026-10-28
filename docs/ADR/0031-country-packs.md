# ADR 0031 — Country packs, Wave 1, and local-currency pricing

- **Status:** Accepted (2026-10-28)

## Context

The owner wants VoiceDesk sold well beyond the UK. Twilio is live, Telnyx is being set up, and both cover 100+ countries. The phone lines aren't the hard part. What changes per country is:

- the emergency number the assistant gives callers;
- call recording consent;
- the hours the assistant may phone people;
- do-not-call registers and marketing consent;
- texting registration (US A2P 10DLC);
- which number ranges are premium-rate (toll fraud);
- time zones, currency and voice accent.

Only a UK pack existed, and several places assumed the UK.

## Decision

- **Country packs** (`packages/compliance/src/countries/`): one `CountryConfig` per country, holding:
  - status (`launched` or `preview`), currency, locale and time zones;
  - emergency numbers;
  - the recording consent model;
  - calling windows (weekday, Saturday, Sunday) and the do-not-call register;
  - which AI-placed calls are allowed (callbacks, confirmations);
  - texting registration;
  - marketing consent;
  - premium prefixes.

  Adding a country = a pack + tests + a legal review + the launch switch.

- **Wave 1 packs:** Ireland, the United States, Canada, Australia and New Zealand. All are `preview`, with `needsLegalReview`. Their values are engineering defaults, not legal advice.
- **Launch gate:** `platform_settings.countries.launched` (Platform admin → Countries, platform owner, password re-check). Onboarding offers only launched countries, with their own time zones first, and `POST /api/tenants` refuses others (`COUNTRY_NOT_LAUNCHED`). The UK is launched in code.
- **Phone numbers:** handled by `libphonenumber-js` 1.13.15 (`/max` metadata):
  - parsing and possible-length checks;
  - country detection, which splits +1 into the US, Canada and the Caribbean;
  - readback in the national format, with long runs split into groups of three.

  Some numbers can't be placed in a country, such as test ranges like Ofcom's 07700 900xxx. These fall back to the pack with that calling code, except +1, where an unknown number is never guessed. The Crown Dependencies count as the UK.

- **Destinations:** blocked are the library's `PREMIUM_RATE`, `SHARED_COST`, `PERSONAL_NUMBER` and `PAGER` types, plus each pack's prefixes:
  - UK 09, 084, 087, 070, 076 and 0118;
  - US and Canada 900 and 976;
  - Australia 190x;
  - New Zealand 0900;
  - Ireland 15xx.

  UK 03 numbers (`UAN`) stay allowed, because ordinary businesses use them. Caribbean +1 numbers are only reachable if their country is explicitly allowed.

- **Texts:** `checkSend` refuses texts (`unregistered`) to a pack with `sms.registration: "10dlc"` (the US) until `platform_settings.countries.smsRegistered` includes it.
- **Calls the assistant places:** `decideOutboundCall` takes the **customer's** country rules (from their number, falling back to the business's country).
  - It follows that country's weekday, Saturday and Sunday windows, in the business time zone. For the UK this now means no Sunday calls and shorter Saturdays, as the UK pack always specified.
  - It refuses call types the country doesn't allow. In the US, Canada and Australia, only callbacks the customer asked for are allowed; confirmation calls are off until review.
- **Recording:** in all-party countries (the US, Australia), the spoken notice adds "By staying on the line, you agree to the recording" (fixed phrases in 6 languages). It always comes after the AI disclosure.
- **Local-currency pricing:**
  - `PLAN_PRICES` in `plans.ts` holds a price per plan in GBP, EUR, USD, CAD, AUD and NZD, excluding tax:

    | Plan    | GBP | EUR | USD | CAD | AUD | NZD |
    | ------- | --- | --- | --- | --- | --- | --- |
    | Starter | 29  | 35  | 39  | 49  | 59  | 65  |
    | Growth  | 79  | 89  | 99  | 129 | 149 | 159 |
    | Pro     | 219 | 249 | 279 | 359 | 399 | 429 |

  - Allowances stay in GBP-based cost units. US and Canadian carrier minutes cost less than UK ones, so margins hold.
  - Stripe prices are `STRIPE_PRICE_<PLAN>` (GBP, unchanged) and `STRIPE_PRICE_<PLAN>_<CUR>`; `pnpm billing:prices` creates them all, in test mode only.
  - Checkout picks the business's currency; a currency without prices can't be bought yet. Webhooks map any currency's price back to its plan.
  - The website has a currency picker for pricing. The savings comparison stays in pounds and says it's for a UK employer.
- **Formatting:** the tenant details carry `currency` and `locale`. The dashboard value card and the monthly value report use the business's currency.

## Not done (on purpose, or waiting)

- **Legal review** of each Wave 1 pack before it's launched.
- **US A2P 10DLC registration** and local numbers per country (regulatory documents at Twilio or Telnyx). Both cost money.
- **Stripe Tax** (VAT, GST, sales tax) before launch.
- **The customer's own time zone** for US, Canadian and Australian outbound calls: the business time zone is used, a known gap.
- **Accent-matched default voices** (American, Australian). This waits for an ElevenLabs key with `voices_read`, so the voice ids can be verified before pinning.
- **Savings figures per country** on the website.
