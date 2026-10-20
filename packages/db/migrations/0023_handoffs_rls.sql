-- handoffs is tenant data: forced RLS (ADR 0003).
ALTER TABLE "handoffs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "handoffs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "handoffs"
  USING ("tenant_id" = app_current_tenant() OR app_platform_access())
  WITH CHECK ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "handoffs" TO voicedesk_app;
--> statement-breakpoint
-- Presence is per user (no tenant): the API only ever touches the signed-in user's row.
GRANT SELECT, INSERT, UPDATE, DELETE ON "agent_presence" TO voicedesk_app;
