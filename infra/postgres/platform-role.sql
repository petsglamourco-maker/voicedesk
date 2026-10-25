-- Platform role (security audit M11): the only runtime login allowed to switch on
-- cross-business access (app_platform_access()). It has the same table rights as
-- voicedesk_app (by membership), stays subject to RLS, and its credentials are separate, so
-- the app's own connection can't turn platform access on, even with injected SQL.
-- Runs as the postgres superuser: at first start (docker-entrypoint-initdb.d), or by hand on
-- an existing volume:
--   docker compose exec -T postgres psql -U postgres -f /docker-entrypoint-initdb.d/02-platform-role.sql
-- Local-dev password only; production roles are provisioned by infra code.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'voicedesk_platform') THEN
    CREATE ROLE voicedesk_platform LOGIN PASSWORD 'voicedesk_platform_dev'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
GRANT voicedesk_app TO voicedesk_platform;
GRANT CONNECT ON DATABASE voicedesk TO voicedesk_platform;
GRANT CONNECT ON DATABASE voicedesk_test TO voicedesk_platform;
