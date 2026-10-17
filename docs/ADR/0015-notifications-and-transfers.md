# ADR 0015 — Notifications (confirmations, reminders, staff alerts) and call transfers

- **Status:** Accepted (2026-10-18)

## Context

Phase 3 makes the assistant a real secretary. Customers should get a confirmation when a
booking is made, moved or cancelled, and a reminder before it. The business should hear about
urgent problems straight away, not after the call summary. Callers who ask for a person
should be put through when someone can take the call. Texts cost money, so they must be easy
to test for free and only switched on deliberately.

## Decision

- **Producers say what happened, one worker decides who hears.** Agent services (API and voice
  worker) emit `booking.changed` (created / moved / cancelled) and `staff.alert` (urgent or
  high-priority ticket, a callback request, an urgent message) through an optional `notify`
  hook. The hook adds a job to the `notifications` queue, and a failure there never breaks
  a booking. `apps/workers` turns each job into messages using pure planners
  (`packages/agent-brain/src/notifications.ts`), which are tested against the database.
- **Customer messages:** short, transactional, in the language of the conversation the booking
  came from. They give the business name, service, local time, reference and the number to
  call to change it. An SMS goes to the confirmed number, and an email too if one was given.
  Per business: confirmations on/off, and reminder hours (0 = off; default 24).
- **Reminders:** a BullMQ delayed job per booking (`reminder-<bookingId>`). It's replaced when
  the booking moves, removed when it's cancelled, and re-checked when it fires (skipped if the
  booking changed since).
- **Staff alerts:** an email to owners and admins in the admin language with a link to
  Records, plus an optional SMS to an "alert mobile". No transcript is included.
- **SMS adapter:** `MailpitSmsProvider` (default) delivers each text as an email to Mailpit.
  `TwilioSmsProvider` (REST) is used only with `SMS_PROVIDER=twilio`, which needs the owner's
  approval because of the cost.
- **Transfers (phone calls):** SIP REFER through LiveKit `transferSipParticipant` to the
  business's transfer number, when the business allows it. The business gets a context
  text/email at the same time. A true _warm_ transfer (the assistant briefs a person before
  connecting) needs call bridging and a human console, so it moves to Phase 5.

## Consequences

- Messages are sent at least once (queue retries). A duplicate confirmation is possible after a
  crash, but a lost one is not.
- Texts use an alphanumeric sender by default, so customers can't reply to them. Each text
  says which number to call.
- UK PECR: these are service messages, not marketing, and are allowed without marketing consent.
  Marketing stays behind `contacts.marketing_consent`.
