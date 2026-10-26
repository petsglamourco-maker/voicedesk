-- Instant demos (ADR 0029). demos: tenant data under forced RLS.
ALTER TABLE "demos" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "demos" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "demos"
  USING ("tenant_id" = app_current_tenant() OR app_platform_access())
  WITH CHECK ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "demos" TO voicedesk_app;
--> statement-breakpoint
-- demo_requests: the platform owner's record of every demo (and optional lead email).
-- Platform-only: a business can never read it.
ALTER TABLE "demo_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "demo_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "platform_only" ON "demo_requests" FOR ALL
  USING (app_platform_access()) WITH CHECK (app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "demo_requests" TO voicedesk_app;
