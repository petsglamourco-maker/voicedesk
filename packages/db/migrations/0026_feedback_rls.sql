-- feedback is tenant data: forced RLS (ADR 0003).
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "feedback" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "feedback"
  USING ("tenant_id" = app_current_tenant() OR app_platform_access())
  WITH CHECK ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "feedback" TO voicedesk_app;
