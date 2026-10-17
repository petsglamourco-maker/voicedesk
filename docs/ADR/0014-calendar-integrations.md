# ADR 0014 — Calendar integrations (Google first, Outlook next)

- **Status:** Accepted (2026-10-17)

## Context

Phase 3 makes the assistant book into the business's real diary: it must only offer times
that are free in their calendar, and every booking must appear there. Businesses use Google
Calendar or Microsoft 365. Calls must never fail because a calendar API is slow or down.

## Decision

- `CalendarProvider` adapter (`packages/adapters/src/calendar`). `GoogleCalendarProvider`
  calls Calendar API v3 over plain HTTPS, with our own OAuth 2.0 web-server flow
  (`GoogleOAuthClient`): no `googleapis` SDK. Outlook (Microsoft Graph) comes next and
  implements the same interface.
- **Scopes:** `calendar.events`, `calendar.freebusy` and `calendar.calendarlist.readonly`,
  plus `openid email` (to show which account is connected). There's no full calendar read
  access: we see busy times, not other appointments' details.
- **Tokens:** one `calendar_connections` row per business and provider (forced RLS). The
  refresh token is encrypted with `SecretBox` (AES-256-GCM, context
  `calendar_connections:<tenant>:<provider>`). Disconnecting revokes it at Google.
- **OAuth `state`:** HMAC-signed with the auth secret, expires after 10 minutes and is bound
  to the browser by an HttpOnly nonce cookie (one use). The callback also checks that the user
  finishing the flow started it and can still configure the agent.
- **Availability:** `listBusy` = VoiceDesk's confirmed bookings **plus** Google free/busy
  (cached 60 s per business and window). Bookings create a Google event with
  `sendUpdates=none` (VoiceDesk sends its own confirmations; Google never emails
  customers).
- **Failure:** if Google errors, the assistant carries on with VoiceDesk's own bookings, the
  connection shows "Problem" and the error, and the next success clears it. `invalid_grant`
  marks the connection "Needs reconnecting" and stops using it.

## Microsoft 365 (added 2026-10-18)

- `MicrosoftCalendarProvider` uses Microsoft Graph: `calendarView` for busy times (events
  shown as "free" or cancelled don't block), plus events in UTC with no attendees, so Outlook
  sends no invitations. Scopes: `Calendars.ReadWrite`, `User.Read`, `offline_access`.
- Microsoft rotates refresh tokens on every refresh, and the old token lapses about 90 days
  after it was issued. The provider hands each new token to `updateRefreshToken`, which
  re-encrypts it.
- Microsoft has no per-app revoke endpoint. Disconnecting deletes our token, and the business
  removes VoiceDesk under My Account → Apps.
- One calendar per business: connecting a second provider is refused (409) until the first
  is disconnected, so availability has a single source of truth.

## Consequences

- A booking can exist in VoiceDesk without its Google event if Google was down at that
  moment. It still blocks the slot. Re-syncing missing events is a follow-up.
- Before real customers connect, the Google OAuth app needs Google's verification (the
  calendar scopes are "sensitive"). Until then it's limited to test users and shows an
  "unverified app" screen. Apps left in "Testing" status get refresh tokens that expire
  after 7 days, so the development app should be set to "In production" (unverified).
