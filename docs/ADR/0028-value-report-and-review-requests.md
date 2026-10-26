# ADR 0028 — Monthly value report and review requests

- **Status:** Accepted (2026-10-26)

## Context

Two features to help small businesses buy VoiceDesk and stay with it:

1. Owners who can see what the assistant did cancel less often. The daily brief covers yesterday, but nothing adds up a whole month or says what it was worth.
2. Reviews matter to small businesses. VoiceDesk already asks customers how it went, so it can invite them to leave a public review.

## Decision

### Monthly value report

- **What it covers:** `agent-brain/src/value-report.ts` adds up a calendar month in the business's time zone, using data only (no AI, no cost):
  - conversations by channel (not the test console);
  - calls outside the approved opening hours (`isOpenNow`; left out when no hours are known);
  - missed calls picked up (`entry <> 'direct'`);
  - bookings made by the assistant (a booking with a real conversation);
  - follow-up wins (`follow_ups.booking_id`);
  - messages taken, call minutes and CSAT.
- **Estimated value** = assistant bookings × `agent_settings.average_booking_pence`. It's only shown when the business has set that value. We never invent a "time saved" multiplier.
- **Sending:** on the 1st (up to the 3rd, if the worker was down) after 08:00 local, for the previous month, to owners and admins.
  - `claimDueValueReports` claims it with a conditional update of `value_report_sent_for` (`YYYY-MM`), on the shared `brief.tick`.
  - Months with no conversations are skipped.
  - It's on every plan (it's a retention tool), with the setting `value_report` defaulting to on.
- **Where:** a preview in Assistant settings → Reports, and a "Your assistant this month" card on the dashboard (`GET /api/tenants/:id/value-report?period=`).

### Review requests

- **Settings:** `agent_settings.review_requests` (default off) and `review_link`. The link must be https with no login in it; turning the feature on needs a link and the `feedback` plan feature.
- **Everyone who answers a survey is invited, whatever the score.** Asking only satisfied customers ("review gating") breaks Google's review policy, and the CMA treats it as misleading under the DMCC Act 2024. Low scores still alert the business privately, as before.
- **Wording:** fixed phrases in 6 languages (`reviewInvite`).
- **Where it appears:** a button on the rating page, a link in the website-chat survey, and one sentence added to the WhatsApp/SMS thanks. No extra message is sent, so it costs nothing.
- **Limits:** at most once a year per contact (`feedback.review_offered_at`). It's offered once per survey (a conditional update).
- **The link** is tracked: `GET /api/public/review/:token` records `review_clicked_at` and redirects only to the business's stored page, and only for a survey that was actually invited (no open redirect). The Feedback page shows how many invitations were shown and how many were opened.

## Consequences

- The report's out-of-hours count depends on the approved opening hours; without them, that line is left out.
- Review invitations go to unhappy customers too. That's deliberate and compliant: the low-score alert gives the business the chance to put things right first.
