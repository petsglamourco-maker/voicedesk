-- mailboxes is tenant data: forced RLS (ADR 0003). Passwords inside are encrypted too.
ALTER TABLE "mailboxes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mailboxes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "mailboxes"
  USING ("tenant_id" = app_current_tenant() OR app_platform_access())
  WITH CHECK ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "mailboxes" TO voicedesk_app;
