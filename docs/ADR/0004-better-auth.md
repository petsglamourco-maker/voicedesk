# ADR 0004 — Better Auth (self-hosted) instead of Clerk

- **Status:** Accepted (2026-10-16)

## Context

We need organizations (multi-tenant), invitations, roles, MFA and later SSO, at the lowest cost and with personal data kept in our own (UK) database.

## Decision

Use Better Auth 1.7, hosted in the API and backed by our Postgres through its Drizzle adapter, with UUID ids.

**Plugins:**

- `organization`: roles `owner` / `admin` / `staff`; invitations; email verification required before accepting.
- `twoFactor`: TOTP with backup codes.

**Email and password:** email verification is required before first sign-in.

**Auth emails:** verification and invitation emails go through a BullMQ queue to the worker.

**Audit:** membership events (invited, joined, role changed, removed, invitation cancelled) and session creation are written to `audit_log` via hooks.

**Schema:** generated with `pnpm --filter @voicedesk/auth generate-schema` into `packages/db/src/schema/auth.ts`.

**Telemetry:** disabled.

## Alternatives

- **Clerk:** fastest to set up, but a paid, US-hosted sub-processor holding identity data.
- **Auth.js:** weaker organization support.

## Consequences

- We operate auth security ourselves: rate limiting, secret rotation, patching. Track Better Auth releases.
- Better Auth's `afterUpdateMemberRole` and `afterRemoveMember` hooks don't pass the acting user, so the audit actor is null for those events until Phase 7.
- SSO (SAML/OIDC) can be added with Better Auth's SSO plugin when enterprise tenants need it.
