-- Automatic phone numbers (ADR 0032): tenant data under forced RLS. The workers buy numbers
-- across businesses through the platform login (app_platform_access()).
ALTER TABLE "number_identities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "number_identities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "number_identities"
  USING ("tenant_id" = app_current_tenant() OR app_platform_access())
  WITH CHECK ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "number_identities" TO voicedesk_app;
--> statement-breakpoint
ALTER TABLE "number_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "number_orders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "number_orders"
  USING ("tenant_id" = app_current_tenant() OR app_platform_access())
  WITH CHECK ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "number_orders" TO voicedesk_app;
