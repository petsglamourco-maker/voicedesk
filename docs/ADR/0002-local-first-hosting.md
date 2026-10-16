# ADR 0002 — Local-first development; UK hosting at launch

- **Status:** Accepted (2026-10-16)

## Context

The owner wants the lowest possible cost until paying customers arrive. Everything runs on a Windows 11 machine with Docker Desktop.

## Decision

- **Infrastructure in Docker Compose:**
  - Postgres 17 + pgvector
  - Valkey (Redis-compatible)
  - SeaweedFS (S3-compatible storage; MinIO's Docker Hub images are no longer published)
  - Mailpit (catches all email)
- **App processes run on the host** with `pnpm dev`: web on :3000, API on :4000, workers' health check on :4100.
- **No paid services in Phase 0.** Paid providers (Anthropic, Twilio, Deepgram, TTS) are introduced in their phases, after the owner approves the cost.
- **At launch, deploy to a UK region.** Candidates: Fly.io London (lowest cost) or AWS eu-west-2 (ECS/Fargate, RDS, S3), decided in a later ADR based on scale and compliance needs. The voice worker needs long-running processes, so it can't run on Vercel.

## Consequences

- Every service sits behind an adapter or a connection URL, so moving to managed services is configuration, not a code change.
- Local data has no backups. Never put real customer data on the dev machine.
