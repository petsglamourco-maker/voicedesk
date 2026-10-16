# CLAUDE.md — VoiceDesk

Multi-tenant AI receptionist / customer-support / virtual-assistant platform. The full product brief is the source of requirements. Decisions are in `docs/ADR/`. Built by the owner plus Claude only. **Cheapest options; runs locally until paying customers** (ADR 0002).

## Status

- **Phase 0 (Foundations): done.** Monorepo, local infra, DB schema v1 with RLS, Better Auth (orgs, invites, roles, TOTP 2FA), API, email worker, web dashboard, adapters, compliance skeleton, tests and e2e.
- **Next:** Phase 1, knowledge ingestion and the text agent. It needs an Anthropic API key; ask the owner before any paid usage.

## Layout

```
apps/api          Fastify API: Better Auth at /api/auth/*, /api/me, /api/tenants, OpenAPI at /api/docs
apps/web          Next.js 16 dashboard; proxies /api/* to the API (same-origin cookies)
apps/workers      BullMQ processors (email); health on :4100
apps/voice-agent  placeholder (Phase 2, see ADR 0008)
packages/db       Drizzle schema, migrations (incl. RLS SQL), withTenant/withPlatformAccess, test helpers
packages/auth     Better Auth factory + roles (generates packages/db/src/schema/auth.ts)
packages/core     domain logic: permissions matrix, tenants/membership, audit helper
packages/adapters provider interfaces + mocks; SMTP email, S3 storage
packages/jobs     queue names, job payload types, Redis connection
packages/compliance  per-country config (GB), PII redaction, redacting pino logger
packages/ui       shared React primitives (shadcn-style, Tailwind v4 tokens from apps/web)
packages/config   tsconfig bases + loadRootEnv()
```

## Commands (run from repo root)

| Command                                         | What it does                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm infra:up` / `pnpm infra:down`             | Start/stop Postgres, Valkey, SeaweedFS and Mailpit (Docker Desktop must be running)               |
| `pnpm install`                                  | Install dependencies                                                                              |
| `pnpm db:migrate`                               | Apply migrations to the dev database (`pnpm --filter @voicedesk/db migrate:test` for the test DB) |
| `pnpm db:generate`                              | Generate a migration after editing the Drizzle schema                                             |
| `pnpm db:seed`                                  | Platform owner (from `.env`) + 2 demo businesses; idempotent                                      |
| `pnpm dev`                                      | API :4000, workers, web :3000                                                                     |
| `pnpm verify`                                   | Lint + typecheck + all tests. **Must pass before declaring work done.**                           |
| `pnpm test:e2e`                                 | Playwright journey; reuses running dev servers or starts them                                     |
| `pnpm --filter @voicedesk/auth generate-schema` | Regenerate the Better Auth tables after changing auth plugins                                     |

Tests need the Docker infra running. They use the separate `voicedesk_test` database; e2e uses the dev database.

## Conventions

- **Tenant data:** every tenant-owned table has `tenant_id`, with forced RLS added in a custom SQL migration (`drizzle-kit generate --custom`). The guard test fails otherwise.
- **Query order:** in API handlers, call `requireTenantAccess(deps, req, tenantId, permission)` first, then `withTenant(db, tenantId, tx => ...)`. Return 404 (not 403) to non-members. Never trust a client-supplied tenant without the membership check.
- **Cross-tenant access** only through `withPlatformAccess`, which is audited.
- **Audit log:** record security-relevant actions with `recordAudit(tx, …)`; ids only in metadata, no PII. The log is append-only, enforced by the DB.
- **External services** go behind interfaces in `@voicedesk/adapters`, with a mock and contract tests. Check the provider's current docs and pin exact versions before integrating.
- **LLM calls** use model tiers (`realtime` / `reasoning`), never hard-coded model ids in business logic.
- **Storage keys** use `tenantKey(tenantId, ...)`.
- **Logging:** use `createLogger` / `loggerOptions` from `@voicedesk/compliance/logger`. Don't log emails, phones, names, transcripts, tokens or query strings.
- **AI disclosure is mandatory.** `CountryConfig.aiDisclosure.required` is typed `true` and must never become configurable off.
- **Dependencies:** exact pins. pnpm's release-age gate stays on; never add `minimumReleaseAgeExclude`. If a version is too new, pick the previous release. Install scripts are allow-listed in `pnpm-workspace.yaml` (`allowBuilds`).
- **TypeScript:** TS 6.0, strict, ESM, `verbatimModuleSyntax` (use `import type`). Workspace packages export `.ts` source; there is no build step.
- **Next.js 16:** `params`, `searchParams` and `cookies()` are async. `middleware` is now `proxy`. Read `apps/web/AGENTS.md` and `node_modules/next/dist/docs/` for version-matched docs.
- **UI strings:** go in `apps/web/messages/en.json` (next-intl). Logical CSS (`ms-`, `me-`, `start-`) keeps RTL working.
- **Commits:** small, conventional (`feat(scope): …`), with the Co-Authored-By trailer.

## Environment variables

`.env.example` lists them all. Copy it to `.env` and set `BETTER_AUTH_SECRET` and `PLATFORM_OWNER_PASSWORD`. Key variables:

- `DATABASE_URL`: runtime, RLS-bound role
- `DATABASE_OWNER_URL`: migrations only
- `TEST_DATABASE_*`: the test database
- `REDIS_URL`
- `S3_*`
- `SMTP_*` and `EMAIL_FROM`
- `BETTER_AUTH_URL` and `WEB_ORIGIN`: the browser-facing origin (:3000)
- `API_INTERNAL_URL`: where the web app proxies `/api/*`
- `WORKER_HEALTH_PORT`

## Local URLs

- Web: http://localhost:3000
- API docs: http://localhost:3000/api/docs
- Mailpit: http://localhost:8025
- S3: http://localhost:8333

## Gotchas

- pnpm 12 blocks dependency install scripts unless they're listed in `allowBuilds`.
- MinIO's Docker images are gone, so we use SeaweedFS (`infra/seaweedfs/s3.json` holds the dev credentials).
- If you change a migration that has already been applied locally, reset with `docker compose rm -sf postgres && docker volume rm voicedesk_pgdata` before committing it. Never edit a committed migration.
- Drizzle wraps Postgres errors ("Failed query…"); the real error is in `error.cause`.
- The Next dev overlay may flag a hydration mismatch on password fields during Playwright screenshots (caret-color). That's a test artifact, not an app bug.
