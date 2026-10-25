# VoiceDesk security

VoiceDesk is a multi-tenant AI receptionist: it answers businesses' phone calls, website chat, WhatsApp and email, books appointments and takes messages. It holds personal data of the businesses' customers (names, numbers, transcripts, call recordings). This document covers:

- the security controls in place;
- the threat model;
- what is monitored;
- what to do when something goes wrong;
- the rules any future mobile app must follow.

- **Standard:** OWASP ASVS 4.0 Level 2 (web and API), OWASP MASVS (mobile), OWASP Top 10 for LLM applications (the AI assistant).
- **Status (2026-10-25):** runs on the owner's computer with demo data and a few live test lines. The gap audit and its fixes are in [docs/security/AUDIT.md](docs/security/AUDIT.md) and [docs/security/REPORT.md](docs/security/REPORT.md). Items marked **pre-launch** must be done before paying customers.

## Reporting a vulnerability

Email the security contact in [`/.well-known/security.txt`](apps/web/public/.well-known/security.txt). Please don't test against real businesses' lines or data. We aim to reply within 3 working days.

## Architecture and trust boundaries

```
 Caller ──PSTN──► Twilio/Telnyx ──SIP──► LiveKit Cloud ──► voice worker (apps/voice-agent)
 Visitor ─────► website chat frame (our origin, embedded on allowed sites only)
 WhatsApp/Meta ─► signed webhook ─┐
 Customer mailbox ◄─ IMAP/SMTP ───┤
 Staff browser ──► Next.js web (:3000) ──proxy /api──► Fastify API (:4000) ──► Postgres (RLS)
                                                          │            ├──► Valkey (queues, limits)
                                                          ▼            └──► S3 (files, recordings)
                                            workers (apps/workers) ──► AI providers (Claude, DeepSeek, local)
```

**Trust boundaries:**

1. The browser and the API: the session cookie, Origin checks and CSRF.
2. The public surfaces: chat, forms, rating links and webhooks, which need no sign-in.
3. One business and another: tenant isolation.
4. A business and the platform owner: cross-business access.
5. The app and AI models: untrusted text in prompts.
6. The app and carriers: money leaves through calls and texts.
7. The app and customer-supplied hosts: SSRF.

## Threat model (STRIDE)

| Threat                                       | Where               | Main controls                                                                                                                                                                                                            |
| -------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Spoofing** a staff member                  | sign-in             | Argon2id passwords, breached-password check, lockout after 10 failures, two-step login (TOTP) required for owners/admins (7-day grace) and the platform owner, new-device emails, sessions list with sign-out-everywhere |
| Spoofing a customer on the phone             | caller ID           | caller ID is never proof: booking changes need the reference **and** the name ([tools.ts](packages/agent-brain/src/tools.ts))                                                                                            |
| Spoofing an email sender                     | email inbox         | auto-replies only to DMARC/DKIM-verified senders ([mailbox.ts](packages/adapters/src/email/mailbox.ts))                                                                                                                  |
| Spoofing VoiceDesk's pages                   | cross-site requests | `Origin`/`Referer` check on every change ([origin-check.ts](apps/api/src/lib/origin-check.ts)), SameSite cookies, form-encoded bodies only on the form webhook                                                           |
| **Tampering** with another business's data   | API                 | forced RLS on every tenant table; `requireTenantAccess` returns 404 to outsiders; generic tests cover every table and every tenant route                                                                                 |
| Tampering with history                       | DB                  | `audit_log`, `consent_events`, `spend_events`, `spend_alerts` and `processed_messages` are append-only for the app role (guard test)                                                                                     |
| Tampering through AI                         | prompts             | markers neutralised, untrusted blocks, tool results treated as data, completion tools gated by state, approvals for back-office actions                                                                                  |
| **Repudiation**                              | admin actions       | audit log with actor and IP: sign-ins, 2FA, password changes, role changes, every platform change (field names only), recording downloads, approvals (fingerprints), suspensions                                         |
| **Information disclosure** across businesses | DB/API              | RLS; a separate `voicedesk_platform` login is the only one that can switch on cross-business access ([platform-role.sql](infra/postgres/platform-role.sql))                                                              |
| Disclosure via SSRF                          | crawler, mailbox    | public-address check with DNS pinning and IPv4-mapped/NAT64 handling ([public-address.ts](packages/adapters/src/net/public-address.ts))                                                                                  |
| Disclosure via logs                          | logs                | deep redaction of personal data and secrets, SQL parameters stripped ([logger.ts](packages/compliance/src/logger.ts))                                                                                                    |
| Disclosure via AI                            | prompts             | only the approved profile and tool results; never reveals instructions (injection evals)                                                                                                                                 |
| Disclosure of secrets at rest                | DB                  | AES-256-GCM with key ids and rotation ([secret-box.ts](packages/core/src/secret-box.ts))                                                                                                                                 |
| **Denial of service / denial of wallet**     | AI, calls, texts    | monthly allowances per business, send guard (pause switches, suspension, allowed countries, premium-number block), shared request limits, chat stream limits, bot check, upload parser limits, AI timeouts               |
| Toll fraud and SMS pumping                   | carriers            | `checkSend` on every text, call and transfer ([send-guard.ts](packages/agent-brain/src/send-guard.ts)); `calls:outbound` permission                                                                                      |
| **Elevation of privilege**                   | roles               | role matrix ([permissions.ts](packages/core/src/permissions.ts)); password re-check for platform changes and role changes; no one-request business deletion                                                              |

## Controls

### Accounts and sessions (ASVS V2, V3)

- **Passwords:**
  - at least 10 characters;
  - Argon2id, using Node's built-in implementation with OWASP settings ([password.ts](packages/auth/src/password.ts)); old scrypt hashes are upgraded at sign-in;
  - checked against Have I Been Pwned (k-anonymity; the check fails open after 3 s).
- **Lockout:** 10 wrong passwords pause the account for 15 minutes, and the owner is emailed.
- **Password reset:** a single-use link that expires after 30 minutes and signs out every device. Changing the password can sign out other devices.
- **Sessions:**
  - end after 7 days without use;
  - a Sessions panel lists them;
  - cookies are HttpOnly and SameSite=Lax, and Secure on https.
- **Two-step login (TOTP):**
  - required for Platform admin;
  - required for owner/admin features after a 7-day grace ([mfa.ts](packages/core/src/mfa.ts)).
- **Step-up:** platform writes, role changes, removals and admin invites need the password confirmed in the last 5 minutes ([fresh-auth.ts](apps/api/src/lib/fresh-auth.ts)).

### Access control and tenancy (ASVS V4)

- Forced RLS on every tenant table, with a guard test that fails if one is missed.
- API order: `requireTenantAccess` first, then `withTenant`; outsiders get 404.
- **Cross-business access** only through `withPlatformAccess`:
  - it is audited;
  - it runs on the separate `voicedesk_platform` login;
  - `app_platform_access()` refuses the app role.
- **Generic tests:**
  - [tenant-routes.test.ts](apps/api/test/tenant-routes.test.ts): every `/api/tenants/:tenantId` route refuses an outsider;
  - [tenant-isolation.test.ts](packages/db/test/tenant-isolation.test.ts): every tenant table hides other businesses' rows.

### Input, output and the browser (ASVS V5, V13, V14)

- **Validation:** Zod on every route body and query.
- **Uploads:**
  - the bytes must match the type; the server sets the content type;
  - extraction limits: 500 PDF pages, a zip-bomb check, 50k CSV rows, 2M characters, 60 s.
- **Headers:**
  - CSP is **report-only** for now (reports to `/api/csp-report`); see the runbook below for enforcing it;
  - HSTS on https;
  - `X-Frame-Options: DENY` (except the embeddable chat frame, which uses `frame-ancestors` for the business's allowed sites);
  - `Permissions-Policy` with `microphone=(self)`;
  - nosniff;
  - a strict referrer policy.
- **Website chat:** a signed 2-hour token from the frame; an optional Cloudflare Turnstile bot check; stream limits.

### Integrations (ASVS V10, V13)

- **SSRF:** customer-supplied hosts (crawls, mailbox servers) must resolve to public addresses, and connections are pinned to the checked IP.
- **Calendar OAuth:**
  - PKCE (S256), signed state and a one-use nonce cookie;
  - removing a member disconnects and revokes a calendar they connected.
- **Webhooks:**
  - WhatsApp uses an HMAC signature with a constant-time comparison;
  - the form webhook takes its secret in a header (`?secret=` still accepted and logged) and honours `Idempotency-Key`;
  - duplicates are dropped durably (`processed_messages`).

### AI assistant (OWASP LLM Top 10)

- **LLM01 prompt injection:**
  - customer text can't contain `[Engine note]` or close `<document>` tags;
  - emails and forms are framed as `«untrusted …»` blocks with a random boundary;
  - tool results are neutralised;
  - injection scenarios are in the golden evals ([scenarios.ts](packages/agent-brain/evals/scenarios.ts)).
- **LLM02 data disclosure:** only the approved business profile goes into prompts, and recognised callers get no booking details on caller ID alone.
- **LLM06 excessive agency:**
  - completion tools refuse until required details are confirmed;
  - booking changes are gated by turn order;
  - "Ask VoiceDesk" only proposes, and a person approves. Approvals are fingerprinted and expire after 24 h.
- **LLM10 unbounded consumption:** monthly AI allowances; at the limit, a take-a-message mode with no model call ([message-only.ts](packages/agent-brain/src/message-only.ts)); 20 s timeouts on live turns; usage recorded per business.
- **AI disclosure:** a fixed greeting that can't be switched off.

### Data protection (ASVS V6, V8)

- **Secrets in the database:** AES-256-GCM with context binding, key ids and old keys for reading. Re-encrypt with `pnpm --filter @voicedesk/core reencrypt`.
- **Recordings:** only when the business turns them on, with a spoken notice. They're stored in our S3 under the business's prefix.
- **Consent:** every marketing-consent change is recorded by a database trigger (`consent_events`).
- **DeepSeek:** it processes data in China. Use it with **demo data only** until a UK GDPR transfer risk assessment exists; Platform admin shows this warning.

### Payments (security standard §10, ADR 0023)

- **No card data:** card details are only entered on Stripe's hosted Checkout and customer portal, so VoiceDesk is outside PCI DSS card-data scope (SAQ A). Card payments are never taken by voice.
- **Prices from the server:** the client only names a plan, and the API picks its Stripe Price from `.env`.
- **Who can pay:** buying or changing a plan needs `billing:manage` (owners only) and a fresh password check.
- **Webhooks:**
  - the signature is verified against the raw body (5-minute tolerance against replays);
  - handled event ids are recorded in `stripe_events`;
  - the subscription's latest state is fetched from Stripe rather than trusted from the payload;
  - mismatched businesses, customers or unknown prices are refused.
- **Plan records:** `subscriptions` can only be written through the platform login. Every plan change is audited (`billing.plan_changed` as system, `billing.plan_set` by the platform owner).
- **Keys:** Stripe keys only in `.env`. `pnpm billing:prices` refuses live keys; live keys are for launch only.

### Supply chain (ASVS V14.2)

- Exact dependency pins and a frozen lockfile; pnpm's release-age gate; install scripts allow-listed.
- CI actions pinned to commit SHAs and compose images to digests; Dependabot with a 14-day cooldown.
- CI runs gitleaks, `pnpm audit`, Semgrep (fails on findings) and a CycloneDX SBOM.

## Monitoring and alerts

**What is recorded or alerted today:**

- **Emails to account holders:** account locked; sign-in from a new device.
- **Emails to owners and admins:** spending at 80% and 100% of the allowance (you're copied at 100%).
- **The audit log** (Platform admin, and the business Dashboard's recent activity):
  - failed sign-ins and blocked attempts;
  - two-step login changes;
  - password changes and resets;
  - role changes;
  - platform access and platform changes;
  - recording downloads;
  - suspensions;
  - approvals.
- **API log warnings:**
  - CSP violation reports;
  - the bot check or the breach check being unavailable;
  - form webhook secrets sent in the URL;
  - duplicate webhooks.

**Pre-launch:**

- error tracking (EU region);
- central logs with alerts for:
  - spikes in failed sign-ins;
  - platform access outside expected times;
  - role changes to owner;
  - sudden call or text volume;
  - CSP violations.

## Runbooks

### Something is sending or calling when it shouldn't (toll fraud, SMS pumping, runaway AI)

1. **Platform admin → Spending & limits → Emergency stop:** pause outbound calls, texts or AI for everyone. It takes effect on the next send.
2. If one business is involved, **Suspend** it in the same table.
3. Check the Twilio/Telnyx consoles and the call logs. In Twilio, also turn on **SMS Pumping Protection** and **Voice Geo Permissions** (UK only).
4. Look up the business's audit log and spend for the cause. Rotate any leaked keys (see below).
5. Resume once fixed. Record what happened.

### A key or password has leaked

| Secret                                         | Do this                                                                                                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI provider key                                | Revoke it at the provider, then paste a new one in Platform admin → AI providers.                                                                                                                                                     |
| `SETTINGS_ENCRYPTION_KEY`                      | Generate a new key. Put the old one in `SETTINGS_ENCRYPTION_OLD_KEYS` as `oldid:base64`, set the new key and a new `SETTINGS_ENCRYPTION_KEY_ID`, restart, run `pnpm --filter @voicedesk/core reencrypt`, and then remove the old key. |
| `BETTER_AUTH_SECRET`                           | Change it and restart. **Every session ends** and everyone signs in again. In-flight OAuth flows and chat tokens become invalid; that's harmless.                                                                                     |
| Twilio/Telnyx/LiveKit/Deepgram/ElevenLabs keys | Rotate them in the provider console, then update `.env` and restart.                                                                                                                                                                  |
| Form webhook secret                            | The business clicks **New address and secret** on its Forms page.                                                                                                                                                                     |
| WhatsApp app secret or token                   | Rotate them in the Meta app, then update `.env`.                                                                                                                                                                                      |
| Database passwords                             | `ALTER ROLE … PASSWORD …` as the superuser, then update `.env`.                                                                                                                                                                       |

### An account has been taken over

1. As the platform owner, suspend the business if customers are at risk.
2. Ask the user to reset their password with **Forgot password?** (this signs out every device), and to turn on two-step login.
3. Check the audit log for that account: new devices, role changes, platform changes and recording downloads.
4. Personal data was exposed? Follow the breach steps below.

### A personal data breach (UK GDPR)

1. **Contain:** use the emergency stop, suspend the business, rotate keys, revoke sessions (change `BETTER_AUTH_SECRET` if needed).
2. **Assess:** what data, how many people, how likely is harm. Start a written log with timestamps.
3. **Report:** if the breach is likely to risk people's rights and freedoms, tell the **ICO within 72 hours** of becoming aware (ico.org.uk/for-organisations/report-a-breach/). Tell affected businesses (the controllers) without delay. If the risk is high, people must be told directly.
4. **Learn:** record the cause and the fix, and update this document.

### Restoring from backup (pre-launch)

Today the data is on the owner's computer: keep **BitLocker** on and back up the Docker volumes. Before launch, use:

- managed Postgres with point-in-time recovery;
- versioned S3;
- a tested restore, and a written recovery point and recovery time.

### Enforcing the Content Security Policy

1. Use the app normally for a week, including browser voice calls and the website chat. Check the API logs for `csp violation`.
2. Fix any real violations, then switch `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in [next.config.ts](apps/web/next.config.ts).
3. Before launch, replace `'unsafe-inline'` with nonces.

## Mobile app: binding requirements (OWASP MASVS)

There is no mobile app yet. When it's built, it **must**:

- **MASVS-STORAGE:**
  - keep session tokens only in the iOS Keychain or Android Keystore, never in plain storage, logs or backups;
  - cache no customer data unencrypted.
- **MASVS-CRYPTO:** use the platform's crypto only; no home-made schemes.
- **MASVS-AUTH:**
  - use the same server-side rules (two-step login, step-up, lockout, sessions panel);
  - support biometric unlock of a stored session, without ever storing the password;
  - make "sign out everywhere" sign out the app too.
- **MASVS-NETWORK:** use TLS only, with certificate (public-key) pinning for the API and a pin-rotation plan.
- **MASVS-PLATFORM:**
  - validate deep links (allow-listed paths; no tokens in links);
  - hide sensitive screens in the app switcher and screenshots where possible;
  - send push notifications without sensitive content (no names, numbers or message text), just "You have a new message";
  - keep WebViews off unless needed, and never with JavaScript bridges to untrusted content.
- **MASVS-CODE:** ship no secrets in the bundle; use obfuscated release builds; keep dependencies pinned and scanned like the web app.
- **MASVS-RESILIENCE:** warn on jailbroken or rooted devices; detect tampering for release builds.
- **MASVS-PRIVACY:** collect the minimum, have no third-party analytics without consent, and keep the AI disclosure on every channel.

Every mobile API call goes through the same API, so tenancy, rate limits, spending limits and the audit log apply unchanged.

## Running the security checks locally

| What                                                                | Command                                                                                                           |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| All tests (including RLS, IDOR, auth, spending, injection defences) | `pnpm verify`                                                                                                     |
| Browser journeys (free)                                             | `pnpm --filter @voicedesk/web exec playwright test chat-frame usage onboarding help reauth password-reset visual` |
| Prompt-injection evals (**costs money**, about $0.01 on DeepSeek)   | `pnpm eval --filter=injection`                                                                                    |
| Dependency audit                                                    | `pnpm audit --audit-level high`                                                                                   |
| Static analysis                                                     | see below                                                                                                         |

To run Semgrep locally: it doesn't install on Windows, so run it in Docker with Norton's CA trusted:

```sh
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/src:ro" -v "C:/ProgramData/Norton/Antivirus/wscert.pem:/norton.pem:ro" -w /src semgrep/semgrep:1.180.0 \
  sh -c 'cat /etc/ssl/certs/ca-certificates.crt /norton.pem > /tmp/ca.pem && REQUESTS_CA_BUNDLE=/tmp/ca.pem semgrep scan --error --metrics=off --config p/typescript --config p/nodejsscan --config p/secrets'
```

## Accepted risks (reviewed)

- **Better Auth's own tables (`user`, `session`, `account`) have no RLS.** Better Auth needs them before any business is known. Mitigations:
  - only the auth code and a few lookups by id or email touch them;
  - the app role can't switch on platform access;
  - the API never returns other users' rows.
- **The form webhook secret is stored in plain text** inside RLS-protected endpoint settings, so the Forms page can show it. Pre-launch: show it once and store a hash.
- **CSP allows `'unsafe-inline'` scripts** (Next.js bootstrap) until nonces are added. Pre-launch.
- **No malware scanning of uploads:** no free local scanner. Mitigation: content checks and parser limits; files are only parsed for text. Pre-launch: a scanning service.
- **Spend figures are estimates** from configurable unit costs. Provider bills remain the source of truth.
