# CLAUDE.md — VoiceDesk

Multi-tenant AI receptionist / customer-support / virtual-assistant platform. The full product brief is the source of requirements. Decisions are in `docs/ADR/`. Built by the owner plus Claude only. **Cheapest options; runs locally until paying customers** (ADR 0002). The owner caps Claude spend at about $10/month in the Anthropic Console: ask before anything that costs money, and report spend after live runs.

## Status

- **Phase 0 (Foundations): done.** Monorepo, RLS tenancy, Better Auth (orgs, invites, roles, TOTP 2FA), API, worker, web, adapters, compliance skeleton.
- **Phase 1 (Knowledge & text agent): built.** Crawler, uploads, ingestion with local embeddings, AI business profile with review and approval, conversation engine with personas and flows in 6 languages, streaming test console, records, summaries, evals.
  - Evals: 42 golden conversations (7 flows × 6 languages: enquiry, complaint, booking, convert, reschedule, cancel, message). Latest run on DeepSeek (prompt 2026-10-18.5): 33/42, with 0 hard-check failures. The remaining misses are soft empathy/naturalness scores. About $0.08 per run.
- **AI providers are switchable at runtime** (ADR 0012): Platform admin → AI providers lists Claude, DeepSeek and a local OpenAI-compatible model, each with on/off, priority order and automatic fallback.
- **Phase 2a (browser voice): done and live-tested** (ADR 0013). `apps/voice-agent` runs the same engine through LiveKit Agents. Test console → _Talk by voice_ shows a live transcript and per-turn latency. On DeepSeek the median was 1.5 s; Claude Haiku is still to be tried.
- **Phase 2b (phone calls): built, awaiting a Twilio number.** Platform admin → Phone numbers creates a LiveKit SIP trunk and dispatch rule per number. The worker handles phone jobs: caller ID, silence prompts, hang-up via `end_conversation`, and an in-process stereo WAV recording to our S3. Also built: the Calls log with a 7-day latency dashboard, and the post-call summary email to owners/admins. Buying the number needs the owner's go-ahead because it costs money.
- **Phase 3 (secretary features): in progress** (plan: Google Calendar → manage bookings → contacts & caller recognition → confirmations/reminders/alerts → transfers → Outlook).
  - **Done:**
    - Google Calendar (ADR 0014): Integrations page, OAuth with encrypted tokens, availability merges Google free/busy, bookings create events, falls back safely when Google fails.
    - Manage bookings by phone or chat (find / cancel / reschedule with identity checks).
    - Contacts: caller recognition, CSV import, Contacts pages.
    - Confirmations, reminders and staff alerts (ADR 0015): `notifications` queue; SMS shows in Mailpit until Twilio is approved. Records actions.
    - Phone transfers (ADR 0015): `request_human` on phone calls → `transferTarget` (hours, on-call number for urgent situations) → SIP REFER after the sentence is spoken, with a context text to the person answering. Falls back to a message if the transfer fails.
    - Outlook / Microsoft 365 calendars (Graph, rotating refresh tokens saved encrypted); one calendar per business.
  - **Phase 3 is built.** Live tests need Google or Microsoft OAuth credentials, and the Twilio number for transfers.
- **Phase 4 (omnichannel): built** (ADRs 0016, 0017). Live tests need a Meta app (WhatsApp) and a mailbox app password (email).
  - **Website chat widget:** `/api/public/widget.js` loads an iframe; allowed websites per business.
  - **Unified inbox:** live over SSE, with take over / hand back.
  - **WhatsApp:** Cloud API with a signed webhook; links and QR code.
  - **Email triage:** connected IMAP/SMTP mailbox polled every minute; drafts wait for approval, optional auto-send for simple answers.
  - **Form capture:** hosted `/f/<key>` form plus a webhook for existing forms.
  - **Dev tunnel:** `pnpm tunnel` exposes only `/api/webhooks/*`.
- **Phase 2b live:** the first real phone call worked on 2026-10-20 (Twilio +44 23 8272 1976 via TwiML Bin). Telnyx is built as a second carrier (per-number `provider`).
- **Phase 5 (human VA console): built** (ADR 0018):
  - **VAs across businesses** (Platform admin → VAs) and a Team-page "Answers calls" toggle, with presence and heartbeat;
  - **`/va` console:** ringing calls with atomic answer, browser softphone, live transcript and context, hand back / hang up; chats needing a person across businesses;
  - **handoff routing** per business (`people_then_phone` default); handoff timeline on the call page and in the summary email;
  - **outbound calls** with the business's caller ID, built but off until `SIP_OUTBOUND_*` is set (costs money).
- **Phase 6 (outbound, feedback, VA assistant): built** (ADRs 0019, 0020):
  - **AI outbound calls:** callbacks and booking confirmations through an API-side dialler with compliance checks, voicemail handling and retries. Off by default; needs an outbound trunk (costs money).
  - **CSAT/NPS surveys:** buttons in website chat, a reply in WhatsApp, a link after calls and emails; a Feedback dashboard; low-score alerts.
  - **Daily brief:** an email at 07:30 local time.
  - **"Ask VoiceDesk":** a back-office assistant that proposes actions; a person approves them.
- **Help assistant (ADR 0021): built.** A floating help orb on every signed-in screen: answers from `packages/help` articles plus yes/no setup facts; Contact support emails the platform owner and lists requests under Platform admin → Support requests.
- **Next:** Phase 7 (compliance hardening, billing and launch), which needs plan approval. The eval for prompt 2026-10-20.1 is waiting for the owner's OK.

## Layout

```
apps/api          Fastify API: auth, tenants, knowledge, profile, agent settings,
                  conversations (SSE), records; OpenAPI at /api/docs
apps/web          Next.js 16 dashboard (Knowledge, Business profile, Assistant, Test console,
                  Records, Team…); proxies /api/* to the API (same-origin cookies)
apps/workers      BullMQ: email, knowledge (crawl/extract/embed), ai (profile, summaries); health :4100
apps/voice-agent  LiveKit Agents worker (browser + phone calls): Deepgram STT → agent-brain engine
                  (llmNode) → ElevenLabs TTS; recording, silence handling; health :4200
packages/db       Drizzle schema + migrations (incl. RLS SQL), withTenant/withPlatformAccess, test helpers
packages/auth     Better Auth factory + roles (generates packages/db/src/schema/auth.ts)
packages/core     permissions, tenants/membership, audit, AI provider settings + createAppLlm, SecretBox
packages/adapters provider interfaces + mocks; SMTP, S3, Anthropic + OpenAI-compatible LLMs,
                  RoutedLlmProvider (fallback router), local embeddings, from-env wiring
packages/knowledge  SSRF-safe crawler, extractors (HTML/PDF/DOCX/CSV/TXT), chunker, ingest, searchKnowledge
packages/agent-brain  profile schema/generator/store, personas, phrases (AI disclosure), prompt,
                  state machine, tools, engine (runTurn), DB services, summaries, harness, evals/
packages/jobs     queue names, payload types, Redis connection, recrawl schedules
packages/compliance  per-country config (GB), PII redaction, redacting pino logger
packages/help     end-user help articles (articles/*.md) + HelpIndex search for the Help assistant
packages/ui       shared React primitives (shadcn-style, Tailwind v4 tokens from apps/web)
packages/config   tsconfig bases + loadRootEnv()
```

## Commands (run from repo root)

| Command                                                         | What it does                                                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm infra:up` / `pnpm infra:down`                             | Start/stop Postgres, Valkey, SeaweedFS and Mailpit (Docker Desktop must be running)                                                               |
| `pnpm install`                                                  | Install dependencies                                                                                                                              |
| `pnpm db:migrate`                                               | Apply migrations to the dev database (`pnpm --filter @voicedesk/db migrate:test` for the test DB)                                                 |
| `pnpm db:generate`                                              | Generate a migration after editing the Drizzle schema                                                                                             |
| `pnpm db:seed`                                                  | Platform owner (from `.env`) + 2 demo businesses; idempotent                                                                                      |
| `pnpm dev`                                                      | API :4000, workers, web :3000                                                                                                                     |
| `pnpm verify`                                                   | Lint + typecheck + all tests (free: mock LLM and mock embeddings). **Must pass before declaring work done.**                                      |
| `pnpm test:e2e`                                                 | Playwright journeys; reuses running dev servers or starts them                                                                                    |
| `pnpm eval [--filter=complaint] [--lang=es] [--limit=N]`        | Golden conversations against real Claude. **Costs money** (about $0.5 for all 24); prints spend; reports in `packages/agent-brain/evals/results/` |
| `RUN_LIVE_LLM=1 pnpm --filter @voicedesk/adapters test`         | Live Anthropic adapter tests (fractions of a cent)                                                                                                |
| `RUN_LOCAL_EMBEDDINGS=1 pnpm --filter @voicedesk/adapters test` | Local embedding model tests (downloads ~120 MB once)                                                                                              |
| `pnpm --filter @voicedesk/auth generate-schema`                 | Regenerate the Better Auth tables after changing auth plugins                                                                                     |

Tests need the Docker infra running. They use the separate `voicedesk_test` database; e2e uses the dev database.

## Conventions

- **Tenant data:** every tenant-owned table has `tenant_id`, with forced RLS added in a custom SQL migration (`drizzle-kit generate --custom`; see `0003_rls_phase1.sql` for the loop pattern). The guard test fails otherwise.
- **Query order:** in API handlers, call `requireTenantAccess(deps, req, tenantId, permission)` first, then `withTenant(db, tenantId, tx => ...)`. Return 404 (not 403) to non-members.
- **Cross-tenant access** only through `withPlatformAccess`, which is audited.
- **Audit log:** record security-relevant actions with `recordAudit(tx, …)`; ids only in metadata, no PII. The log is append-only, enforced by the DB.
- **External services** go behind interfaces in `@voicedesk/adapters`, with a mock and contract tests. Check the provider's current docs and pin exact versions before integrating. Apps wire providers through `@voicedesk/adapters/from-env`.
- **LLM calls:**
  - Apps get their LLM from `createAppLlm(db, secrets)` (the router over enabled providers). Never construct a provider directly in app code, and use `isLlmAvailable(llm)` rather than checking provider names.
  - Use model tiers: `realtime` = `LLM_MODEL_REALTIME` (claude-haiku-5-5), `reasoning` = `LLM_MODEL_REASONING` (claude-sonnet-5-5). Never hard-code model ids in business logic.
  - Record cost with `recordLlmUsage`.
  - Treat documents, transcripts and tool results as untrusted data in prompts.
- **Agent engine (ADR 0009):**
  - Required flow steps live in `state.ts` (`missing*Slots`), and completion tools refuse until those slots are filled. Prompt changes bump `PROMPT_VERSION` and need a `pnpm eval` run.
  - Keep the system prompt stable: volatile content goes in per-turn engine notes.
  - Keep the history append-only.
- **Grounding (ADR 0011):** only the _approved_ profile goes into the prompt. Business facts must come from the profile or tool results.
- **AI disclosure is mandatory:** the greeting comes from fixed phrases in `phrases.ts`, and `CountryConfig.aiDisclosure.required` is typed `true`. Never make either configurable off.
- **Storage keys** use `tenantKey(tenantId, ...)`.
- **Outbound HTTP to customer-supplied URLs** must use `createSafeFetcher` (SSRF protection).
- **Logging:** use `createLogger` / `loggerOptions` from `@voicedesk/compliance/logger`. Don't log emails, phones, names, transcripts, tokens or query strings.
- **Dependencies:** exact pins. pnpm's release-age gate stays on; never add `minimumReleaseAgeExclude`. If a version is too new, pick the previous release. Install scripts are allow-listed or denied in `pnpm-workspace.yaml` (`allowBuilds`).
- **TypeScript:** TS 6.0, strict, ESM, `verbatimModuleSyntax` (use `import type`). Workspace packages export `.ts` source and must typecheck **without the DOM lib** (consumers compile them).
- **Next.js 16:** `params`, `searchParams` and `cookies()` are async. Read `apps/web/AGENTS.md` and `node_modules/next/dist/docs/`. Never define components inside render (`react-hooks/static-components`).
- **Design ("Aurora Glow", `DESIGN.md`):** tokens only (no hex in components), components from `@voicedesk/ui`, gallery at `/design`. Token changes must pass `contrast.test.ts`; visual baselines in `apps/web/e2e/visual.spec.ts-snapshots`.
- **Help articles:** when a feature or screen changes, update its article in `packages/help/articles` (the article test checks screens and links, not wording).
- **UI strings:** go in `apps/web/messages/en.json` (next-intl). Use logical CSS (`ms-`, `me-`, `start-`) and `dir="auto"` on user/agent text for right-to-left languages.
- **Commits:** small, conventional (`feat(scope): …`), with the Co-Authored-By trailer.

## Environment variables

`.env.example` lists them all. Copy it to `.env` and set `BETTER_AUTH_SECRET` and `PLATFORM_OWNER_PASSWORD`. Key variables:

- `DATABASE_URL`: runtime, RLS-bound role
- `DATABASE_OWNER_URL`: migrations only
- `TEST_DATABASE_*`
- `VALKEY_PASSWORD` (Valkey requires it; docker-compose reads it) and `REDIS_URL` (`redis://:<password>@localhost:6379`), `S3_*`, `SMTP_*`, `EMAIL_FROM`
- `BETTER_AUTH_URL` and `WEB_ORIGIN`: the browser-facing origin (:3000)
- `API_INTERNAL_URL`, `WORKER_HEALTH_PORT`
- `SETTINGS_ENCRYPTION_KEY`: 32 random bytes, base64. Encrypts API keys stored in the database; without it, keys can't be saved in admin settings
- `ANTHROPIC_API_KEY`: optional fallback key for the Claude provider. Which providers are used is chosen in Platform admin → AI providers; with none switched on, the agent uses the mock
- `LLM_MODEL_REALTIME`, `LLM_MODEL_REASONING`
- `EMBEDDINGS_PROVIDER` (`local` or `mock`) and `MODELS_CACHE_DIR` (default `.cache/models`)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: Google Calendar integration (optional; redirect URI `${WEB_ORIGIN}/api/integrations/google/callback`)
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT`: Outlook / Microsoft 365 (optional; redirect URI `${WEB_ORIGIN}/api/integrations/microsoft/callback`)
- `SMS_PROVIDER` (`mailpit` default; `twilio` / `telnyx` cost money; a list like `telnyx,twilio` falls back in order), `SMS_FROM`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TELNYX_API_KEY`, `TELNYX_MESSAGING_PROFILE_ID`
- Voice (all optional; voice is off until they're set): `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `VOICE_AGENT_PORT` (4200), `SIP_ALLOWED_ADDRESSES` (optional CIDR allow-list for phone trunks)

## Local URLs

- Web: http://localhost:3000
- API docs: http://localhost:3000/api/docs
- Mailpit: http://localhost:8025
- S3: http://localhost:8333

## Gotchas

- **pnpm 12** blocks dependency install scripts unless they're listed in `allowBuilds`.
- **MinIO's Docker images are gone**, so we use SeaweedFS (`infra/seaweedfs/s3.json` holds the dev credentials).
- **Changing an already-applied migration:** reset with `docker compose rm -sf postgres && docker volume rm voicedesk_pgdata` before committing it. Never edit a committed migration.
- **Drizzle wraps Postgres errors** ("Failed query…"); the real error is in `error.cause`.
- **Norton Antivirus inspects TLS on this machine** (`NODE_EXTRA_CA_CERTS`). Turbo's strict env mode would strip that variable, so `turbo.json` passes TLS and proxy variables through. If crawls or model downloads fail with "unable to verify the first certificate", check that first.
- **The file-writing tools convert `\uXXXX` escapes into literal characters.** For regexes that need escapes, write them via Python with `chr(92)`, then check with `grep -nP '[^\x00-\x7F]'`.
- **Newer Chrome returns a Promise from `scrollIntoView`.** Never return it from a `useEffect` arrow ("destroy is not a function").
- **Restart dev processes after adding a workspace dependency.** A running `tsx watch` caches failed resolution (`ERR_MODULE_NOT_FOUND`).
- **Local model servers need a 16k+ context window.** Ollama defaults to 4,096 and silently truncates the start of the prompt, which drops the assistant's rules. "Test connection" warns about this.
- **Tests that mutate `ai_providers` rows** (shared, platform-wide): only `packages/core` tests switch providers on, and they restore the rows afterwards. API tests must not enable providers, because package tests run in parallel.
- **Voice turns are full engine turns** (`EngineVoiceAgent.llmNode` → `runTurn`). Keep `preemptiveGeneration` off, because tools would otherwise run on partial transcripts. Shared turn saving lives in `agent-brain` `persistTurn`; use it for any new channel.
- **LiveKit agent dispatch is explicit** (`agentName: "voicedesk-agent"` in the worker and `VOICE_AGENT_NAME` in the API must match). A browser token only grants its own `vd-<conversationId>` room.
- **Voice worker: no `@livekit/agents-plugin-silero`.** Its onnxruntime-node 1.24 clashes on Windows with the 1.30 that the embeddings model needs in the same process. Use `inference.VAD()` (native local-inference). Pass plugin API keys explicitly, because their default env names differ (ElevenLabs expects `ELEVEN_API_KEY`).
- **Two carriers:** `phone_numbers.provider` is `twilio` or `telnyx`, and trunk security follows it. Twilio trunks need `SIP_AUTH_USERNAME`/`PASSWORD`, which the TwiML Bin sends. Telnyx sends no login, so its trunks use an IP allow-list (`TELNYX_SIGNALLING_IPS`, or `TELNYX_SIP_ALLOWED_ADDRESSES`). Every route rebuild must pass the number's carrier.
- **Approval gates** (ADR 0020): the "Ask VoiceDesk" agent only ever _proposes_ (`assistant_actions` rows). Approved actions must run through the shared dashboard functions (`sendStaffReply`, `cancelBookingAsStaff`, `scheduleCallbackFor`), never their own copies.
- **Outbound AI calls** (ADR 0019):
  - every placement goes through `decideOutboundCall`; never dial around it;
  - attempt status changes stay conditional updates;
  - every opening must keep the AI disclosure.
- **Per-business jobs scan `organization`** (the auth table, no RLS) and then use `withTenant`, rather than a cross-tenant read. Functions that scan accept an `only` list, so tests stay fast on the shared test DB.
- **VA console handoff** (ADR 0018):
  - People from the console join call rooms as `va-<userId>`, and the voice worker keys off that prefix.
  - Keep `session.start({ inputOptions: { participantIdentity: callerIdentity } })`, or the assistant may answer the person instead of the caller.
  - Handoff status changes must stay conditional updates (`claimHandoff` / `moveHandoff`).
- **Phone routing:** one LiveKit inbound trunk and dispatch rule per number. The dispatch metadata `{ tenantId, phoneNumberId }` tells the worker which business a call is for. Reassigning or disabling a number rebuilds the route. `phone_numbers` is platform-write-only (RLS).
- **Recordings never leave our infrastructure:** `session.start({ record: false })` (otherwise LiveKit Cloud would receive session reports), and the in-process `CallRecorder` + `TeeAudioOutput` write `tenants/<id>/recordings/<conversationId>.wav`. Only when `agent_settings.record_calls` is on, which also adds the spoken notice.
- **Notifications:** agent services take an optional `notify` hook and only report events. All "who gets what" logic lives in `agent-brain/src/notifications.ts` planners; `apps/workers` just sends. Never log message text or phone numbers.
- **Per-turn channel instructions** (`state.transfer`, `state.endRequested`) are cleared at the start of every `runTurn`. Never persist them across turns, or a later turn repeats the transfer or hang-up.
- **Booking changes** are gated by turn order in `tools.ts`: cancel needs a later turn than `find_booking`; reschedule needs a later turn than `check_availability`. Don't replace this with a "call twice" confirmation, which made models ask twice or claim success after a refusal (evals 2026-10-18).
- **Calendars:** agent services take `calendars: { box, factory }`. Google failures must never fail a turn (`withCalendar` in `services-db.ts` logs them and marks the connection). Keep event descriptions free of transcripts.
- **LiveKit logs what the assistant says** (`lk.pii.message`) at info level. The voice-agent scripts pass `--log-level warn` to its logger (our own `createLogger` is separate). Keep it that way so transcripts stay out of logs.
- **`@livekit/local-inference` ships a prebuilt binary**, so its install script (a no-op) is denied in `allowBuilds`. The end-of-turn model runs locally (`v1-mini`).
- **Setup status:** Platform admin → Setup (`/platform/setup`, `apps/api/src/lib/setup.ts`) shows which integrations are ready from .env names alone, never values. Keep it updated when adding an integration.
- **Real email in dev:** once SMTP points at a real service, the workers send through `ReservedDomainRouter`. Reserved test domains (example.com, *.test, *.local…) and stand-in texts (`SMS_PROVIDER=mailpit`) still go to Mailpit, so e2e and demo data never mail out. Tests must use Mailpit (`MAILPIT_SMTP_*`), never `SMTP_*`.
- **Twilio outbound:**
  - Calls go LiveKit → Elastic SIP trunk termination (`SIP_OUTBOUND_TWILIO_*`). The LiveKit outbound trunk's login is refreshed from .env on every dial.
  - Errors appear only in Twilio, not our logs. Read them free via `monitor.twilio.com/v1/Alerts`. 32202 = credential mismatch; 32205 = Voice Geo Permissions (Low Risk) not enabled for that country.
  - UK geographic numbers can't send SMS; use an alphanumeric `SMS_FROM`.
- **Local services are bound to 127.0.0.1** (docker-compose ports, `next dev --hostname 127.0.0.1`, API, worker and voice-agent health). Never publish them on 0.0.0.0, because they hold real data with dev credentials (security audit C2).
  - Server-to-server URLs (`DATABASE_URL`, `REDIS_URL`, `API_INTERNAL_URL`…) use `127.0.0.1`, not `localhost`. Node tries `::1` first, and nothing listens there.
  - **e2e runs 2 workers locally.** With more, cold `next dev` stalls page loads for 90 s. The first dashboard load can take 10-20 s while it compiles (`DASHBOARD_TIMEOUT`).
  - The browser origin stays `http://localhost:3000`, because the OAuth redirect URIs are registered for it.
- **Two-step login and password re-checks** (security audit C1, H6):
  - `requirePlatformOwner` refuses without 2FA; business owners/admins lose admin features after a 7-day grace (`mfaBlocks` in `@voicedesk/core`).
  - Platform writes (any non-GET through `requirePlatformOwner`), role changes, removals and admin/owner invites need the password confirmed within 5 minutes (`POST /api/me/reauth`, `deps.freshAuth`). They answer 403 `REAUTH_REQUIRED`. The browser's `api()` and the Team page show the prompt and retry. New sensitive actions should use `requireFreshAuth`.
  - API tests use `makePlatformOwner(h, account)` / `reauth(h, cookie)` from the harness.
- **Sign-in protection** (security audit H4, H5, M16):
  - Passwords are Argon2id (`packages/auth/src/password.ts`, Node's built-in `crypto.argon2`); old scrypt hashes still verify and are upgraded at sign-in.
  - 10 wrong passwords lock the account for 15 minutes and email the owner. New browser/OS families trigger an email (`known_devices` keeps hashes only). See `apps/api/src/lib/sign-in-guard.ts`.
  - Short-lived security state goes through `deps.kv` (Valkey; `memoryKv` in tests): lockouts, password re-checks, Better Auth's limits.
  - Fastify trusts `X-Forwarded-For` only from `TRUSTED_PROXIES`. The auth route overwrites it with `request.ip` before calling Better Auth, so never read the raw header.
  - API limits are counted per session cookie hash or per IP, in Valkey. Better Auth's limits (`AUTH_RATE_LIMITS`) are off in tests unless `createHarness({ authRateLimit: true })`.
  - Breached-password checks call Have I Been Pwned (`packages/auth/src/breach.ts`, `PASSWORD_BREACH_CHECK`, off in tests). They fail open after 3 s with a log warning: an outage must not block sign-ups.
  - Web forms use `method="post"` so a submit before the page loads never puts fields in the URL.
- **Audit:** every successful platform change is logged automatically (`registerPlatformAudit`, field names only). Business deletion through Better Auth is disabled.
- **Customer-supplied hosts** (crawls, mailbox IMAP/SMTP) are checked with `isPublicAddress` / `resolvePublicHost` from `@voicedesk/adapters/net` and connections are pinned to the checked IP. Never connect to a customer-supplied host without it.
- **Playwright screenshots** may trigger a hydration-mismatch warning on password fields (caret-color). That's a test artifact.
