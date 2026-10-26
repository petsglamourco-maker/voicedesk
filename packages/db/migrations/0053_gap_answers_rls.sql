-- Answers for unanswered questions (ADR 0026): tenant data under forced RLS.
ALTER TABLE "gap_answers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "gap_answers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "gap_answers"
  USING ("tenant_id" = app_current_tenant() OR app_platform_access())
  WITH CHECK ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "gap_answers" TO voicedesk_app;
