-- assistant_actions is tenant data: forced RLS (ADR 0003).
ALTER TABLE "assistant_actions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "assistant_actions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "assistant_actions"
  USING ("tenant_id" = app_current_tenant() OR app_platform_access())
  WITH CHECK ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "assistant_actions" TO voicedesk_app;
