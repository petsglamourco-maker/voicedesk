-- phone_numbers: businesses read their own numbers; only platform access (audited) writes,
-- because each number is tied to LiveKit/Twilio routing managed by the platform owner.
ALTER TABLE "phone_numbers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "phone_numbers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_read" ON "phone_numbers" FOR SELECT
  USING ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint
CREATE POLICY "platform_insert" ON "phone_numbers" FOR INSERT
  WITH CHECK (app_platform_access());
--> statement-breakpoint
CREATE POLICY "platform_update" ON "phone_numbers" FOR UPDATE
  USING (app_platform_access()) WITH CHECK (app_platform_access());
--> statement-breakpoint
CREATE POLICY "platform_delete" ON "phone_numbers" FOR DELETE
  USING (app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "phone_numbers" TO voicedesk_app;
