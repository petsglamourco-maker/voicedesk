-- processed_messages is tenant data: forced RLS; append-only for the runtime role.
ALTER TABLE "processed_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "processed_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "processed_messages"
  USING ("tenant_id" = app_current_tenant() OR app_platform_access())
  WITH CHECK ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT ON "processed_messages" TO voicedesk_app;
