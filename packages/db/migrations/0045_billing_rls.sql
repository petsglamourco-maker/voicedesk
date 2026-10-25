-- Plans and billing (ADR 0023). subscriptions is tenant data under forced RLS:
-- - a business can read its own row and insert only its own trial;
-- - everything else (plan changes, Stripe state, comps) needs platform access, i.e. the
--   separate platform login used by the Stripe webhook and Platform admin.
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_read" ON "subscriptions" FOR SELECT
  USING ("tenant_id" = app_current_tenant() OR app_platform_access());
--> statement-breakpoint
CREATE POLICY "tenant_trial_insert" ON "subscriptions" FOR INSERT
  WITH CHECK (
    app_platform_access()
    OR ("tenant_id" = app_current_tenant() AND "plan_id" = 'trial' AND "status" = 'trialing'
        AND "comped" = false AND "stripe_customer_id" IS NULL AND "stripe_subscription_id" IS NULL)
  );
--> statement-breakpoint
CREATE POLICY "platform_update" ON "subscriptions" FOR UPDATE
  USING (app_platform_access()) WITH CHECK (app_platform_access());
--> statement-breakpoint
CREATE POLICY "platform_delete" ON "subscriptions" FOR DELETE USING (app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "subscriptions" TO voicedesk_app;
--> statement-breakpoint
-- Stripe events: platform-only, append-only.
ALTER TABLE "stripe_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "stripe_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "platform_only" ON "stripe_events" FOR ALL
  USING (app_platform_access()) WITH CHECK (app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT ON "stripe_events" TO voicedesk_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "stripe_events" FROM voicedesk_app;
--> statement-breakpoint
-- Businesses created before billing keep working: a complimentary Pro plan.
SELECT set_config('app.platform_access', 'on', true);
--> statement-breakpoint
INSERT INTO "subscriptions" ("tenant_id", "plan_id", "status", "comped")
SELECT "id", 'pro', 'active', true FROM "tenants"
ON CONFLICT ("tenant_id") DO NOTHING;
