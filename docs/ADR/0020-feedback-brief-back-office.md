# ADR 0020 — Feedback, daily brief and the back-office assistant

- **Status:** Accepted (2026-10-21)

## Context

The rest of the brief's Phase 6:

- CSAT/NPS;
- an AI virtual assistant for the business with approval gates;
- a daily brief.

The owner wants the cheapest options, and the assistant must never act on its own.

## Decision

### Feedback (CSAT/NPS)

- **One survey per conversation** (`feedback`, forced RLS):
  - nobody is asked twice within 30 days;
  - every Nth survey asks NPS instead of CSAT (business setting);
  - the wording is fixed in 6 languages, never generated.
- **Channels:**
  - **Website chat:** 1–5 buttons after the goodbye (`end_conversation`).
  - **WhatsApp:** the question is appended to the goodbye, and a bare score reply answers it inside `handleInboundMessage` (no engine turn). Any other text is a normal message.
  - **Calls:** an SMS with a rating link, only if the business opts in, because texts cost money.
  - **Email and form enquiries:** an email with the link.
  - Links are `/r/<token>` with token `<tenantId>.<random>`, so the public endpoint reads the row under that tenant's RLS without a special lookup function.
- **Low scores** (CSAT ≤ 2, NPS ≤ 6) raise a `staff.alert` with record `feedback`.
- **Dashboard:** CSAT %, NPS, by channel, and by who handled it (assistant or a person).

### Daily brief

- **Content:** yesterday at a glance, today's bookings, and what's waiting.
  - Built from the data (no AI, free), in the admin language.
- **Delivery:**
  - one email to owners and admins at 07:30 business-local time;
  - a 15-minute worker tick claims due businesses by setting `brief_sent_on` (conditional update), so each brief goes out once a day.
- **Preview:** available from the settings, without sending.

### "Ask VoiceDesk" (back-office assistant)

- **Reads:** a separate tool loop (`back-office.ts`, reasoning tier) reads the business's data through **the asking user's permissions**. Tools the role lacks aren't offered and are refused if called.
- **Proposes:** a reply to a customer thread, cancelling a booking, or an AI callback. Each proposal is only stored as a pending `assistant_actions` row, and the model is told nothing has happened.
- **Approval:**
  - a person approves, with an optional edit for replies;
  - the claim is atomic (`pending → approving`);
  - the action then runs through **the same functions as the dashboard** (`sendStaffReply`, `cancelBookingAsStaff`, `scheduleCallbackFor`) and is audited.
- **Untrusted data:** tool results are data, never instructions (stated in the prompt). Usage is recorded per call.

## Consequences

- **Rating links don't reach customers yet:** they point at the web origin, so they only work for customers once VoiceDesk is hosted publicly (Phase 7). The in-chat surveys work today.
- **WhatsApp replies:** a reply that's just a number within 24 h of the survey is taken as a score. A customer genuinely answering "3" to something else in that window is a known edge case.
- **Model choice:** the back-office assistant uses whichever AI provider is switched on, so DeepSeek is limited to demo data until the transfer assessment.
