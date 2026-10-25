# ADR 0024 — The mobile app: an installable web app, tested over home Wi-Fi

- **Status:** Accepted (2026-10-25)

## Context

Owners and staff want VoiceDesk on their phones: what's happening today, chats waiting for a person, calls to answer, and alerts. Everything still runs on the owner's PC (ADR 0002), with no paid hosting and no domain. Store apps need developer accounts, a public API with a domain, and review cycles. The security standard's MASVS requirements apply to whatever we ship (SECURITY.md).

## Decision

**A progressive web app (PWA):** the existing Next.js app, installable to the home screen. It is one codebase with the same API rules. A native shell (Capacitor) can come later, once there is hosting and a domain.

### Installing

- **Manifest** (`app/manifest.ts`):
  - opens standalone on `/today`, which redirects to the active business's Today page;
  - Aurora Glow colours; regular and maskable icons (`public/icons`, made from the brand mark);
  - Apple home-screen metadata; `viewport-fit=cover`.
- **Service worker** (`public/sw.js`, served `no-store`):
  - caches **only** the offline page and icons;
  - page loads always use the network, and the offline page shows when there's no connection;
  - it never caches pages or API responses, so no customer data is stored on the phone outside the browser's normal session.

### Layout

- **Under 768 px:** a bottom tab bar (Today, Inbox, Calls, More), with safe-area padding. More opens the full menu, which also has the VA console. The Help orb sits above the tab bar.
- **Today** (`/t/:id/today`, `GET /api/tenants/:id/today`, `inbox:read`) shows, in the business's time zone:
  - today's bookings;
  - chats waiting for a person;
  - calls nobody answered;
  - callbacks booked;
  - new messages to return;
  - the plan allowance (owners and admins).
- **Inbox:** on phones, the thread list and the conversation each take the full screen, with a Back button.
- **The VA console** already adapts to small screens. The browser softphone works on phones over https.
- The Next.js dev badge is off: it covered the tab bar.

### Push notifications (Web Push, free)

- **Keys:** VAPID keys from `pnpm push:keys` into `.env` (`VAPID_*`). Push is off while they're empty. Adapter: `PushProvider` (web-push 3.6.7) with `MockPush`.
- **Storage:** `push_subscriptions` has one row per person and **sign-in session**:
  - deleted with the session (cascade), so signing out or revoking a device stops its notifications;
  - the endpoint and keys are encrypted (SecretBox, bound to the user id) and included in key rotation;
  - the endpoint hash is unique, so a shared browser only notifies whoever is signed in now.
- **Endpoints:** must be a browser push service (FCM, Mozilla, Apple, Windows), because the server sends to them.
- **Events:** sent through the notification planners' new `push` channel, which the workers send:
  - a chat needs a person: owners, admins and the people who answer calls;
  - urgent tickets and messages, and low ratings: owners and admins;
  - a handed-over call is ringing: the people who answer calls (`call.ringing` job from the voice worker);
  - 80% and 100% of an allowance: owners and admins.
- **Content:** notifications say only the business name and the kind of event, never customer names, numbers or message text. Tapping one opens an internal path.
- **Settings:** each person turns notifications on per device under **Account → Notifications on this device**, and can send a test. On iPhone, notifications work only once VoiceDesk is added to the Home Screen (iOS 16.4+), and the page says so.

### Testing on a phone (local only)

- **`pnpm mobile:lan`** (`infra/mobile-lan.mjs`) is an https proxy on the PC's Wi-Fi address, port 8443, that forwards to the web app on 127.0.0.1:3000, including SSE and websockets.
  - Certificate: from mkcert. The phone trusts mkcert's root CA once.
  - Security: it refuses clients outside private network ranges and runs only while started. The services stay bound to 127.0.0.1 (audit C2).
- **`EXTRA_WEB_ORIGINS`:** the proxy's origin is added here.
  - It is accepted only for https home-network addresses (`parseExtraOrigins`).
  - It feeds the API's origin check, Better Auth's trusted origins and Next's `allowedDevOrigins`.

## Alternatives

- **Native apps now (React Native / Capacitor):** rejected for now. They need store accounts, a public API and certificate pinning against a real domain. The PWA covers today's needs.
- **Exposing the dev server on 0.0.0.0:** rejected (audit C2). The proxy keeps one deliberate, temporary, private-network-only entry point.
- **A paid push service:** not needed, because Web Push is free and standard.

## Consequences

- One codebase serves desktop and phone, and every security control applies unchanged.
- iPhone users must add VoiceDesk to the Home Screen before turning notifications on.
- When hosting arrives:
  - `mobile:lan` and `EXTRA_WEB_ORIGINS` are no longer needed;
  - the public domain gets real TLS;
  - push works the same.
