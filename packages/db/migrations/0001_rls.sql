-- Tenant isolation via Row-Level Security.
--
-- The runtime role (voicedesk_app) has no BYPASSRLS. FORCE ROW LEVEL SECURITY makes the
-- table owner subject to the policies too, so migrations/seeds must also set a tenant or
-- platform context to touch tenant data.
--
-- Context is set transaction-locally by @voicedesk/db withTenant()/withPlatformAccess().

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_platform_access() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('app.platform_access', true), '') = 'on' $$;
--> statement-breakpoint

-- tenants (keyed by id rather than tenant_id)
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenants"
  USING ("id" = app_current_tenant() OR app_platform_access())
  WITH CHECK ("id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint

-- contacts
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contacts"
  USING ("tenant_id" = app_current_tenant() OR app_platform_access())
  WITH CHECK ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint

-- va_assignments
ALTER TABLE "va_assignments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "va_assignments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "va_assignments"
  USING ("tenant_id" = app_current_tenant() OR app_platform_access())
  WITH CHECK ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint

-- audit_log: tenant-scoped reads; inserts for the current tenant or platform-level (null) events.
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "audit_select" ON "audit_log" FOR SELECT
  USING ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint
CREATE POLICY "audit_insert" ON "audit_log" FOR INSERT
  WITH CHECK ("tenant_id" IS NULL OR "tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint

-- Append-only audit log: no UPDATE/DELETE/TRUNCATE for anyone (trigger) or the app role (grants).
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION 'audit_log is append-only'; END $$;
--> statement-breakpoint
-- Statement-level so it fires even when RLS filters the statement down to zero rows.
CREATE TRIGGER "audit_log_immutable" BEFORE UPDATE OR DELETE OR TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
--> statement-breakpoint

-- Runtime grants (also covered by default privileges in local dev; explicit for other envs).
GRANT USAGE ON SCHEMA public TO voicedesk_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO voicedesk_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO voicedesk_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM voicedesk_app;
