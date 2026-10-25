-- Security audit M11: only the separate platform login (voicedesk_platform), the migration
-- owner and SECURITY DEFINER functions owned by it can switch on cross-business access.
-- Before, the app's own role could run set_config('app.platform_access', 'on') itself.
-- (Requires the voicedesk_platform role: infra/postgres/platform-role.sql.)
CREATE OR REPLACE FUNCTION app_platform_access() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT coalesce(current_setting('app.platform_access', true), '') = 'on'
       AND current_user IN ('voicedesk_platform', 'voicedesk_owner')
  $$;
--> statement-breakpoint
-- The public-endpoint resolver (website chat, forms) runs as its owner so it can look a key
-- up across businesses; it returns only the one matching row and resets the flag.
CREATE OR REPLACE FUNCTION app_resolve_public_endpoint(p_kind text, p_key text)
  RETURNS TABLE (id uuid, tenant_id uuid, enabled boolean, config jsonb)
  LANGUAGE plpgsql VOLATILE
  SECURITY DEFINER
  SET search_path = public
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
REVOKE ALL ON FUNCTION app_resolve_public_endpoint(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_resolve_public_endpoint(text, text) TO voicedesk_app;
