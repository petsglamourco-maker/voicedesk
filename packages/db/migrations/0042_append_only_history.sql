-- Default privileges give the runtime role UPDATE and DELETE on every new table, so the
-- append-only tables must revoke them explicitly (as audit_log does). History that can be
-- rewritten from the app isn't evidence of anything.
REVOKE UPDATE, DELETE, TRUNCATE ON "consent_events" FROM voicedesk_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "spend_events" FROM voicedesk_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "spend_alerts" FROM voicedesk_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "processed_messages" FROM voicedesk_app;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "platform_settings" FROM voicedesk_app;
