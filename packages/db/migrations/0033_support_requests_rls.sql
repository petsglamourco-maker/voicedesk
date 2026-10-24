-- support_requests (ADR 0021): anyone signed in can file a request, scoped to the business
-- they're in (or none); only the platform owner, under withPlatformAccess (audited), can read,
-- resolve or delete them. Inserts therefore never use RETURNING.
ALTER TABLE "support_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "support_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "own_insert" ON "support_requests" FOR INSERT
  WITH CHECK (
    "tenant_id" IS NULL OR "tenant_id" = app_current_tenant() OR app_platform_access()
  );
--> statement-breakpoint
CREATE POLICY "platform_read" ON "support_requests" FOR SELECT
  USING (app_platform_access());
--> statement-breakpoint
CREATE POLICY "platform_update" ON "support_requests" FOR UPDATE
  USING (app_platform_access()) WITH CHECK (app_platform_access());
--> statement-breakpoint
CREATE POLICY "platform_delete" ON "support_requests" FOR DELETE
  USING (app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "support_requests" TO voicedesk_app;
