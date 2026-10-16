# ADR 0001 — pnpm + Turborepo monorepo, strict TypeScript

- **Status:** Accepted (2026-10-16)

## Context

VoiceDesk has several deployables (web dashboard, API, job workers, voice worker, chat widget) that share domain logic, DB schema and provider adapters. The team is one developer working with Claude.

## Decision

- One repository with pnpm workspaces (`apps/*`, `packages/*`) and Turborepo for task orchestration and caching.
- TypeScript 6.0 in strict mode, plus `noUncheckedIndexedAccess` and `verbatimModuleSyntax`. We pin 6.0, not 7.0 (the native compiler), because typescript-eslint supports TS < 6.1.
- Internal packages export TypeScript source. Node services run it with `tsx`, and Next.js uses `transpilePackages`. There is no per-package build step.
- One ESLint flat config at the root (type-aware rules) and one Prettier config.
- Exact version pins for every dependency. pnpm's `minimumReleaseAge` gate stays on (we don't bypass it), and `allowBuilds` in `pnpm-workspace.yaml` allow-lists install scripts.

## Consequences

- A change to shared code is type-checked against every consumer in one `pnpm verify`.
- Production images will need a bundling step (e.g. `tsup`/esbuild) or will run with `tsx`. That decision is deferred to the hosting ADR at launch.
