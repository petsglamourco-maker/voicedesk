-- Spending limits (ADR 0022). spend_events and spend_alerts are tenant data: forced RLS,
-- and append-only for the runtime role (no UPDATE or DELETE), so recorded spend can't be
-- rewritten from the app.
ALTER TABLE "spend_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "spend_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "spend_events"
  USING ("tenant_id" = app_current_tenant() OR app_platform_access())
  WITH CHECK ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT ON "spend_events" TO voicedesk_app;
--> statement-breakpoint
ALTER TABLE "spend_alerts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "spend_alerts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "spend_alerts"
  USING ("tenant_id" = app_current_tenant() OR app_platform_access())
  WITH CHECK ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT ON "spend_alerts" TO voicedesk_app;
--> statement-breakpoint
-- platform_settings: not tenant data. Readable by the runtime role (every sender checks the
-- kill switches), writable only under withPlatformAccess() (audited).
ALTER TABLE "platform_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "platform_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "platform_settings_read" ON "platform_settings" FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY "platform_settings_write" ON "platform_settings" FOR ALL
  USING (app_platform_access()) WITH CHECK (app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "platform_settings" TO voicedesk_app;
--> statement-breakpoint
SELECT set_config('app.platform_access', 'on', true);
--> statement-breakpoint
INSERT INTO "platform_settings" ("id", "spend") VALUES ('global', '{"maxCapPence":{"ai":10000,"sms":10000,"calls":10000},"costs":{"voicePencePerMinute":6,"phoneInboundPencePerMinute":1,"phoneOutboundPencePerMinute":3,"smsPencePerSegment":4,"usdToGbp":0.79},"paused":{"outboundCalls":false,"sms":false,"ai":false},"allowedCountries":["GB"]}')
ON CONFLICT ("id") DO NOTHING;
