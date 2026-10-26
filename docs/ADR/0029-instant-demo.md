# ADR 0029 — Instant demo on /try

- **Status:** Accepted (2026-10-26)

## Context

Potential customers are convinced fastest by hearing an assistant answer for their own business. A public page where they type in their website and talk to the result turns interest into sign-ups. It's also a public, unauthenticated way to spend our money, so it needs firm limits.

The owner chose two things:

- demos use the same AI providers as everything else (DeepSeek first today), and the page says so plainly;
- the page asks for an optional email with a consent tick, for sales follow-up.

## Decision

- **Off by default.** `platform_settings.demos = { enabled, dailyLimit }`, set in Platform admin → Demos (platform owner, password re-check, audited).
- **A demo is a real, short-lived business** (`tenants.demo_expires_at`, 24 h). Reusing everything means the crawl, the profile generator, the engine and browser voice all work unchanged. It has:
  - no members;
  - an organization marked `{"demo":true}`;
  - the **`demo` plan**: no features, 0 texts, 0 outbound calls, a 40p AI allowance and 10 voice minutes. It's not in `PLAN_IDS`, so it can't be bought or given.
  - every sending setting off.
- **Nothing ever leaves a demo:**
  - the demo routes pass no `notify` hook;
  - the voice worker drops notifications for `demo` jobs;
  - `checkSend` refuses through the plan's zero allowances;
  - the gap sweep skips demo organizations;
  - with no members, no emails or briefs have anyone to go to.
- **The visitor's key** is `<tenantId>.<random>`, like rating links, so public requests stay under normal tenant RLS. Only a SHA-256 of the random part is stored, it's compared in constant time, and it's sent in the `X-Demo-Key` header, never in URLs.
- **Flow:**
  1. `POST /api/public/demos` checks, in order: the switch, an AI provider, the bot check, consent when an email is given, the URL (public hosts only; the crawl is SSRF-safe), 3 an hour per IP (an HMAC of the IP), and the daily limit (an atomic Valkey counter, then a database count).
  2. It creates the business and a 10-page website source.
  3. The knowledge worker then queues `demo.build`, which generates the profile and **approves it automatically**. This is the only exception to ADR 0011, acceptable for a 24-hour demo of the visitor's own site.
  4. A failed crawl or profile ends the demo with a reason code.
- **Use:**
  - **Chat:** `POST /api/public/demos/chat`, at most 20 turns (a conditional update).
  - **Voice:** `POST /api/public/demos/voice`, at most 3 calls. The dispatch metadata is `{ demo: true, maxSeconds: 180 }`, and the worker says a fixed closing phrase and hangs up at the limit.
  - **Both** use `test_console` conversations, so they're kept out of stats, surveys and follow-ups.
  - The AI disclosure greeting is unchanged.
- **Clean-up:** the 15-minute notifications tick runs `purgeExpiredDemos`. It copies the AI cost and usage to `demo_requests`, then deletes the organization, and the cascade removes every tenant row. Only rows that still carry `demo_expires_at` are deleted.
- **Platform record:** `demo_requests` (platform-only RLS) keeps the website, status, cost and the optional lead email. The email is only taken with the ticked consent, cleared after 90 days, and can be forgotten on request.

## Consequences

- Each demo costs a few pence. The daily limit and per-IP limit cap the exposure, and the Demos page shows the spend.
- Demo crawls share the knowledge worker (one at a time), so a busy crawl queue delays demos.
- The privacy notice names DeepSeek in China. If the provider mix changes, the notice must be updated.
- Demo audit rows (`demo.created`, `profile.approved`) stay in the audit log after the business is deleted (it has no FK).
