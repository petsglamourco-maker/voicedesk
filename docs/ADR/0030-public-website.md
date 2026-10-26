# ADR 0030 — The public website (Ringwise)

- **Status:** Accepted (2026-10-26)

## Context

Customers need a website that explains the service, shows the value it creates, and shows what a business saves compared with hiring a receptionist. The owner chose the name **Ringwise** for the website. The app, emails and the AI greeting keep "VoiceDesk" until the name has been checked (domain, Companies House, UKIPO) and registered.

## Decision

- **Where:** the website lives in `apps/web` at `/`.
  - Signed-out visitors see it.
  - Signed-in people are still sent to onboarding or their business, as before.
  - It shares the design system and sits on the same origin as `/try`, `/sign-up` and `/sign-in`.
- **The name** is one constant, `SITE_NAME` in `src/components/site/brand.ts`, so a later rename is one line. The text is in `messages/en.json` under `site.*`.
- **Prices come from billing:** `GET /api/public/plans` returns the paid plans from `packages/core/src/plans.ts` and the trial length. The website can't show a price that billing doesn't charge.
- **Savings calculator:** a pure function (`receptionistCost`, unit tested) runs in the browser, and nothing is sent. It's based on 2026/27 public rates:
  - National Living Wage £12.71 an hour (GOV.UK);
  - employer National Insurance 15% above £5,000 a year (HMRC), with a toggle for small employers whose Employment Allowance covers it;
  - the minimum 3% employer pension on qualifying earnings (£6,240–£50,270).

  At the defaults (37.5 hours a week), a receptionist costs about £28.3k a year, against £948 a year on Growth.

- **The "missed calls" line** uses only the visitor's own numbers, with the assumption shown on screen (a quarter turned into bookings).
- **Honest claims only.** There are no invented statistics, testimonials or certifications. Features are listed only if they're built. Trust lines are phrased from what's actually true.
  - Nothing claims "data stays in the UK", because conversations go to AI providers abroad.
  - Every figure is marked as an estimate, with its source.
- **The demo button** ("Hear your own receptionist") only shows when instant demos (ADR 0029) are switched on.

## Consequences

- When plans change in `plans.ts`, the website updates by itself. The savings rates need a yearly check each April.
- Privacy and terms pages are still needed before launch. Legal text needs the owner (or a solicitor), so it isn't written here.
- Renaming the product in the app later is a separate change. It includes the fixed AI-disclosure phrases, which mention the business, not VoiceDesk.
