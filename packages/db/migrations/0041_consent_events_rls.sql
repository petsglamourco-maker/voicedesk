-- consent_events (security audit M18): tenant data, forced RLS, append-only for the app.
ALTER TABLE "consent_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "consent_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "consent_events"
  USING ("tenant_id" = app_current_tenant() OR app_platform_access())
  WITH CHECK ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT ON "consent_events" TO voicedesk_app;
--> statement-breakpoint
-- Whatever changes a contact's marketing consent (staff, import, a form, the assistant), the
-- change is recorded. The app may name the source with SET LOCAL app.consent_source.
CREATE OR REPLACE FUNCTION record_consent_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.marketing_consent IS DISTINCT FROM OLD.marketing_consent THEN
    INSERT INTO consent_events (tenant_id, contact_id, kind, granted, source)
    VALUES (
      NEW.tenant_id,
      NEW.id,
      'marketing',
      NEW.marketing_consent,
      NULLIF(current_setting('app.consent_source', true), '')
    );
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER contacts_consent_history
  AFTER INSERT OR UPDATE OF marketing_consent ON contacts
  FOR EACH ROW EXECUTE FUNCTION record_consent_change();
