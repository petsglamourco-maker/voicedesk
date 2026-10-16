# VoiceDesk

A multi-tenant AI receptionist, customer support and virtual assistant platform for UK businesses (and beyond).

> Status: **Phase 0 — Foundations** complete. See [CLAUDE.md](CLAUDE.md) for architecture and conventions, and [docs/ADR](docs/ADR/README.md) for decisions.

## Run it locally (Windows)

**You'll need:** Node 24+, pnpm 12 (`corepack enable`), Docker Desktop and Git.

```bash
# 1. Configuration
cp .env.example .env
#    then edit .env and set BETTER_AUTH_SECRET (32+ random chars) and PLATFORM_OWNER_PASSWORD

# 2. Infrastructure: Postgres + pgvector, Valkey, SeaweedFS (S3), Mailpit
pnpm infra:up

# 3. Dependencies, database and demo data
pnpm install
pnpm db:migrate
pnpm db:seed

# 4. Run everything
pnpm dev
```

Then open:

- **App:** http://localhost:3000. Sign up, verify your email, create a business, and invite your team.
- **Email inbox (Mailpit):** http://localhost:8025. Every email the app sends lands here, nothing goes out.
- **API docs:** http://localhost:3000/api/docs

The seed creates a platform owner (`PLATFORM_OWNER_EMAIL` / `PLATFORM_OWNER_PASSWORD` from `.env`) with two demo businesses.

## Checks

```bash
pnpm verify      # lint + typecheck + unit/integration tests (incl. tenant isolation)
pnpm test:e2e    # browser test: sign up → create business → invite staff → accept
```

The first e2e run needs a browser: `pnpm --filter @voicedesk/web exec playwright install chromium`.
