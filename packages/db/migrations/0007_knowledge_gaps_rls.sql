-- knowledge_gaps is tenant data: same forced-RLS pattern as 0001/0003 (ADR 0003).
ALTER TABLE "knowledge_gaps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge_gaps" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "knowledge_gaps"
  USING ("tenant_id" = app_current_tenant() OR app_platform_access())
  WITH CHECK ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "knowledge_gaps" TO voicedesk_app;
