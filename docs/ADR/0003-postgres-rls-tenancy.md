# ADR 0003 — Postgres Row-Level Security for tenant isolation

- **Status:** Accepted (2026-10-16)

## Context

One tenant must never be able to read another's data (contacts, calls, recordings, knowledge). Application-level `WHERE tenant_id = ?` checks alone fail open when a query forgets them.

## Decision

- **Tenant id:** tenant = business = Better Auth `organization`. The `tenants` table shares the organization's UUID.
- **Every tenant-owned table:**
  - has a non-null `tenant_id`;
  - has `ENABLE` + `FORCE ROW LEVEL SECURITY`;
  - has the policy `tenant_id = app_current_tenant() OR app_platform_access()`.
- **Two database roles:**
  - `voicedesk_owner` runs migrations.
  - `voicedesk_app` is the runtime role: `NOBYPASSRLS`, not a superuser, and can't disable RLS.
- **Tenant context:** `withTenant(db, tenantId, fn)` sets `app.tenant_id` with `set_config(..., true)` (transaction-local), so context can't leak across pooled connections. Without context, queries return zero rows (fail closed).
- **Cross-tenant access** (platform owner, system jobs) goes only through `withPlatformAccess()`, which writes an audit entry in the same transaction.
- **Audit log:** `audit_log` is append-only. UPDATE/DELETE/TRUNCATE are revoked from the app role and blocked for everyone by a statement-level trigger.
- **Auth tables are global:** Better Auth tables (`user`, `session`, `member`, `invitation`, …) have no RLS. Only Better Auth and the membership service in `@voicedesk/core` access them.

## Consequences

- `packages/db/test/tenant-isolation.test.ts` proves the guarantees. One of its tests fails if any table with a `tenant_id` column lacks forced RLS. The suite was mutation-checked: weakening a policy fails 9 tests.
- API handlers must authorize membership (`requireTenantAccess`) _before_ calling `withTenant`. RLS is the safety net, not the authorization check.
- GDPR erasure will need a controlled exception for audit rows (anonymize, don't delete), designed in Phase 7.
