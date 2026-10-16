# ADR 0005 — Drizzle ORM with hand-written SQL for RLS

- **Status:** Accepted (2026-10-16)

## Decision

- Use Drizzle ORM 0.45 with node-postgres for queries and schema.
- Generate migrations with `drizzle-kit generate`.
- Write roles, RLS policies, functions, grants and triggers as **custom SQL migrations** (`drizzle-kit generate --custom`), so the security-critical SQL is explicit and reviewable.
- Apply migrations with Drizzle's migrator (`pnpm db:migrate`) as the owner role.

## Why

Drizzle is thin, close to SQL, has first-class Postgres types (uuid, jsonb, inet, pgvector), and Better Auth supports it directly. Prisma's generated client and engine add weight and make transaction-scoped `set_config` awkward.

## Consequences

- drizzle-kit doesn't track policies defined in raw SQL. Any new tenant table needs its RLS added in a custom migration; the guard test enforces this.
