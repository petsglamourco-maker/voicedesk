-- known_devices: user-level (no tenant_id), read and written by the API at sign-in, like the
-- Better Auth tables. Holds only a hash of browser + OS family per account.
GRANT SELECT, INSERT, UPDATE, DELETE ON "known_devices" TO voicedesk_app;
