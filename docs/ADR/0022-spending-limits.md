# ADR 0022 — Spending limits, safe destinations and the emergency stop

- **Status:** Accepted (2026-10-24)

## Context

The security audit (H3, M10) found that nothing on the server limited spending. Texts could go to any international number (SMS pumping through public chat), people with `calls:read` could phone any number with no cap (toll fraud), there was no kill switch, and the "suspended" business status was never enforced. Until billing exists (Phase 7) the platform owner pays every provider, so runaway usage is a direct cost.

## Decision

- **A monthly allowance per business.** `allowanceFor()` (`agent-brain/src/spend.ts`) gives each business's AI / texts / calls allowance. Today that's the platform allowance in `platform_settings` (£100 each by default). With billing it becomes the subscription plan's allowance; only `allowanceFor` changes. **The plan alone decides what a business can use.** VoiceDesk doesn't cap anything the plan covers, and a business that runs out is asked to upgrade (until billing: "contact VoiceDesk support"). Every tier must be priced to be profitable from measured unit costs.
- **Business-set limits are optional** (owner decision, 2026-10-24). With `platform_settings.businessCaps` (Platform admin → "Let businesses set their own limits", **off by default**), owners can also choose lower limits (`agent_settings.*_cap_pence`) within the allowance. While it's off, the limit is the allowance and `PUT /spend` answers 409 `PLAN_LIMITS_ONLY`.
- **Spend comes from what's already recorded**, using editable cost estimates in `platform_settings`:
  - AI: `llm_usage.cost_usd` × the USD→GBP rate;
  - calls: voice minutes (rounded up per call) × voice rate, plus the carrier rate for phone calls by direction;
  - texts: `spend_events` rows written when a real carrier sends a text (Mailpit stand-ins cost nothing).
  Months follow the business's time zone.
- **What happens when the limit is reached** (the allowance, or the business's own lower limit):
  - AI: `loadAgentContext` sets `ctx.aiPaused`; `runTurn` takes a fixed **take-a-message** route (name → number → message → `services.takeMessage`) in all six languages with no model call. Ask VoiceDesk, profile generation and AI summaries pause; Help answers from articles only.
  - Texts: skipped in the workers' notification processor (emails still go).
  - Calls: outbound calls refused; incoming calls are still answered (in take-a-message mode if AI is capped too).
- **One send guard, `checkSend()`** (`agent-brain/src/send-guard.ts`), used by every text (workers), both dial points (AI dialler and VA console) and phone transfers. It refuses for:
  - a platform pause switch;
  - a suspended business;
  - a reached cap;
  - a destination outside the allowed countries (GB by default) or a premium/special-rate number (UK 09, 087, 084, 070, 118, pagers 076 except Isle of Man 07624).
  Transfer, on-call and alert numbers are checked when saved too.
- **`calls:outbound` permission.** Owners and admins always; staff and VAs only when the business turns on "People who answer calls can also phone customers" (`agent_settings.answerers_can_call_out`, default off).
- **Emergency stop and suspension** in **Platform admin → Spending & limits**: pause outbound calls, texts or AI for every business; suspend or resume a business (audited, password re-check). A suspended business's assistant only says the service isn't available, and its texts and calls stop.
- **Alerts:** at 80% and 100% of a cap, owners and admins get one email per category per month (`spend_alerts` unique row); platform owners get a copy at 100%. Runs on the workers' 15-minute tick.

## Consequences

- Spend figures are estimates; the platform owner keeps the cost estimates in line with provider bills.
- `spend_events` and `spend_alerts` are append-only for the runtime role.
- `platform_settings` is shared: tests must not change it (pass `settings` to `checkSend` instead).
- Every new sender (a new channel, a new carrier) must go through `checkSend`; every new AI feature must respect `aiPauseFor`.
