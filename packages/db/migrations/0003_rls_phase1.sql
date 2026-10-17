-- Phase 1 tenant tables: same forced-RLS pattern as 0001_rls.sql (see ADR 0003).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'knowledge_sources',
    'knowledge_documents',
    'knowledge_chunks',
    'business_profiles',
    'agent_settings',
    'conversations',
    'conversation_messages',
    'tickets',
    'staff_messages',
    'bookings',
    'llm_usage'
  ]
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
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO voicedesk_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO voicedesk_app;
--> statement-breakpoint
-- The audit log stays append-only for the runtime role.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM voicedesk_app;
