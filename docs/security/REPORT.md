# Security hardening: final report (2026-10-25)

**Scope:** the VoiceDesk monorepo (web, API, workers, voice worker, packages) and its local infrastructure.

**Standard:**

- OWASP ASVS 4.0 Level 2 (web and API);
- OWASP Top 10 for LLM applications (the assistant);
- MASVS requirements recorded for the future mobile app.

**Method:**

1. A read-only audit ([AUDIT.md](AUDIT.md)): 3 critical, 7 high and 18 medium findings, plus low and pre-launch items.
2. Fixes in severity order, in six batches on branch `security/hardening`.
3. Every batch was tested with `pnpm verify` (lint, typecheck, all unit and integration tests) and the free browser journeys.
4. Nothing paid was run.

## Result

| Severity | Found | Fixed | Remaining                                                                                                           |
| -------- | ----- | ----- | ------------------------------------------------------------------------------------------------------------------- |
| Critical | 3     | 3     | none                                                                                                                |
| High     | 7     | 6     | **H7**: data on the dev machine. Needs BitLocker and backups (owner action), then managed hosting.                  |
| Medium   | 18    | 18    | Partial items are listed below.                                                                                     |
| Low      | 11    | 5     | Pagination, public `/api/docs`, API versioning, feedback token expiry, staff contact deletion, widget storage note. |

## What was fixed

| Item | Fix                                                                                                                           | Commit                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| C1   | Two-step login enforced: the platform owner immediately, owners and admins after a 7-day grace                                | `74676aa`              |
| C2   | All local services bound to 127.0.0.1; Valkey requires a password                                                             | `d695558`              |
| C3   | SSRF bypasses (IPv4-mapped, NAT64, 6to4) closed with a shared public-address check and DNS pinning                            | `fa71fee`              |
| H1   | Single-request business deletion disabled                                                                                     | `fc946fe`              |
| H2   | Mailbox hosts must be public, mail ports only, STARTTLS enforced, generic errors                                              | `4153a0a`              |
| H3   | Monthly allowances; send guard for every text, call and transfer; premium/foreign number block; `calls:outbound`              | `32165dc`, `8194911`   |
| H4   | Lockout, trusted proxies only, request limits in Valkey per session, Better Auth limits on, new-device alerts                 | `356305c`              |
| H5   | Password reset, change password, sessions panel, breached-password check                                                      | `be8e363`              |
| H6   | Audit log gaps closed (actor and IP everywhere); password re-check for sensitive admin actions                                | `fc946fe`, `0241f3a`   |
| M1   | Origin check on every change; form-encoded bodies only on the form webhook                                                    | `b96554f`              |
| M2   | Injection defences (marker neutralising, untrusted blocks, neutralised tool results), injection evals added                   | `190b86d`              |
| M3   | Signed chat-frame token, Turnstile bot check (off until keys), stream limits                                                  | `e0ad286`              |
| M4   | CSP (report-only), HSTS, Permissions-Policy, secure cookies, frame headers corrected                                          | `b96554f`              |
| M5   | Upload content checks, server-set content types, parser limits                                                                | `b96554f`              |
| M6   | Durable webhook dedupe; form secret in a header; `Idempotency-Key`                                                            | `3619a6f`              |
| M7   | PKCE, Secure nonce cookie, calendar revoked when its member is removed                                                        | `3619a6f`              |
| M8   | Caller ID isn't proof: booking changes need the name; no booking details on recognition                                       | `190b86d`              |
| M9   | Approvals expire, are fingerprinted with the IP, and only the requester or an allowed role can reject                         | `190b86d`              |
| M10  | Emergency stop (calls, texts, AI) and enforced suspension                                                                     | `32165dc`, `64e566f`   |
| M11  | Separate `voicedesk_platform` login for cross-business access; generic table and route isolation tests                        | `d9311bc`              |
| M12  | Key ring with rotation command; separate OAuth state key; placeholder secrets refused                                         | `ef951a8`              |
| M13  | Deep log redaction; SQL parameters and personal data stripped from errors                                                     | `ef951a8`, `d9311bc`   |
| M14  | Email auto-send only to DMARC/DKIM-verified senders                                                                           | `3619a6f`              |
| M15  | Timeouts for live AI turns (20 s), SMTP and LiveKit                                                                           | `ef951a8`              |
| M16  | Argon2id with transparent upgrade of old hashes                                                                               | `be8e363`              |
| M17  | SHA-pinned actions, image digests, Dependabot, Semgrep (clean), SBOM, explicit release-age gate                               | `453b90d`              |
| M18  | Consent history by database trigger; the DeepSeek data warning is shown in Platform admin                                     | `ef951a8`              |
| Low  | `microphone=(self)`, chat frame not `DENY`, explicit secure cookies, `/\host` help links, constant-time WhatsApp verify token | `b96554f`, this commit |

Also found and fixed during the work:

- **Real issues, flagged by Semgrep:** a fixed AES-GCM tag length, and the WhatsApp QR code is no longer injected as HTML.
- **History tables:** default database privileges had made the "append-only" history tables editable by the app. They now `REVOKE`, with a guard test.
- **A regression from this work:** the log formatter crashed the API on its first request log. It was fixed with a regression test in the next commit.
- **A performance problem from batch 1:** internal `localhost` URLs were slowed by IPv6 lookups; they now use 127.0.0.1.

## Tests added

| Area             | Test files                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts         | `apps/api/test/account-security.test.ts`, `sign-in-protection.test.ts`, `security-audit.test.ts`                                                            |
| Spending         | `spend.test.ts`                                                                                                                                             |
| Website chat     | `widget-guard.test.ts`                                                                                                                                      |
| Isolation        | `tenant-routes.test.ts` (all 81 tenant routes); in packages/db, `tenant-isolation.test.ts` (generic RLS loop, platform login) and `consent-history.test.ts` |
| AI               | `message-only.test.ts`, `untrusted.test.ts`, the injection scenario in the golden evals                                                                     |
| Uploads          | `file-safety.test.ts`                                                                                                                                       |
| Logging          | the compliance logger tests                                                                                                                                 |
| Adapters         | `human-check.test.ts`, `sender-auth.test.ts`, `public-address.test.ts`                                                                                      |
| Browser journeys | `reauth`, `password-reset`, `usage` and `chat-frame` specs                                                                                                  |

All of these run in CI (`pnpm test`) once the repository is on GitHub.

## Partly done, or deliberately left

- **CSP:** report-only. Enforce it after a week of normal use with no reports (runbook in [SECURITY.md](../../SECURITY.md)), and add nonces before launch.
- **Form webhook secret:** still stored readable so the Forms page can show it. Hash it at launch.
- **Email auto-send:** no daily cap yet (verified senders only).
- **Better Auth tables:** no RLS (accepted; see SECURITY.md).
- **Upload malware scanning:** pre-launch.
- **Injection evals:** written, not run (DeepSeek, about $0.01). Needs your OK.

## Your actions

1. **Turn on two-step login** for the platform owner account (Account → Two-step login). Platform admin stays locked until you do.
2. **Turn on BitLocker** on this PC, and back up the Docker volumes (closes H7 for now).
3. **Create the private GitHub repository and push** (step-by-step guide to follow), so CI runs the security tests, Semgrep, gitleaks, the dependency audit and the SBOM.
4. **Optional:** create the free Cloudflare Turnstile keys to switch the bot check on.
5. **Optional:** OK the injection eval run (about $0.01).
6. **Before launch:** the pre-launch list in [AUDIT.md](AUDIT.md) (hosting with encryption at rest and backups, retention, data-subject rights, privacy paperwork, monitoring, an external pen test, Cyber Essentials Plus).
