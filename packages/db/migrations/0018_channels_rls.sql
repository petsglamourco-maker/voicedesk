-- Phase 4 tenant data: forced RLS (ADR 0003).
ALTER TABLE "public_endpoints" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public_endpoints" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "public_endpoints"
  USING ("tenant_id" = app_current_tenant() OR app_platform_access())
  WITH CHECK ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "public_endpoints" TO voicedesk_app;
--> statement-breakpoint
ALTER TABLE "channel_threads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "channel_threads" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "channel_threads"
  USING ("tenant_id" = app_current_tenant() OR app_platform_access())
  WITH CHECK ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "channel_threads" TO voicedesk_app;
--> statement-breakpoint
-- Resolves a public key (widget/form) or WhatsApp phone-number id to its business without a
-- signed-in user. Platform access is switched on only for this one lookup, then restored, so
-- public requests don't flood the audit log and can't see anything else.
CREATE OR REPLACE FUNCTION app_resolve_public_endpoint(p_kind text, p_key text)
  RETURNS TABLE (id uuid, tenant_id uuid, enabled boolean, config jsonb)
  LANGUAGE plpgsql VOLATILE
AS $$
DECLARE
  previous text := current_setting('app.platform_access', true);
BEGIN
  PERFORM set_config('app.platform_access', 'on', true);
  RETURN QUERY
    SELECT e.id, e.tenant_id, e.enabled, e.config
    FROM public_endpoints e
    WHERE e.kind = p_kind AND e.key = p_key;
  PERFORM set_config('app.platform_access', coalesce(previous, ''), true);
END
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_resolve_public_endpoint(text, text) TO voicedesk_app;
