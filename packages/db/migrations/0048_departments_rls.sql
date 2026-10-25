-- Departments and the phone menu (ADR 0025): tenant data under forced RLS.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['departments', 'department_members', 'department_moves']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "tenant_isolation" ON %I
         USING ("tenant_id" = app_current_tenant() OR app_platform_access())
         WITH CHECK ("tenant_id" = app_current_tenant() OR app_platform_access())',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "departments", "department_members" TO voicedesk_app;
--> statement-breakpoint
-- Department moves are history: append-only for the app.
GRANT SELECT, INSERT ON "department_moves" TO voicedesk_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "department_moves" FROM voicedesk_app;
--> statement-breakpoint
-- conversations.department_id (no Drizzle reference: the schemas would import each other).
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_department_id_departments_id_fk"
  FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "conversations_tenant_department_idx" ON "conversations" ("tenant_id", "department_id");
