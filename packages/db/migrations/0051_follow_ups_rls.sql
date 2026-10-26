-- Follow-ups (ADR 0026): tenant data under forced RLS.
ALTER TABLE "follow_ups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "follow_ups" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "follow_ups"
  USING ("tenant_id" = app_current_tenant() OR app_platform_access())
  WITH CHECK ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "follow_ups" TO voicedesk_app;
