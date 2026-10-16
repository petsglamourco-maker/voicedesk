-- Runs once, as the postgres superuser, when the Docker volume is first created.
-- Local-dev passwords only; production roles are provisioned by infra code.

-- Migration/owner role: owns tables, runs DDL. Not a superuser.
CREATE ROLE voicedesk_owner LOGIN PASSWORD 'voicedesk_owner_dev';

-- Runtime role: subject to Row-Level Security. NOBYPASSRLS is the default but stated explicitly.
CREATE ROLE voicedesk_app LOGIN PASSWORD 'voicedesk_app_dev' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

CREATE DATABASE voicedesk OWNER voicedesk_owner;
CREATE DATABASE voicedesk_test OWNER voicedesk_owner;

\connect voicedesk
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;
GRANT USAGE ON SCHEMA public TO voicedesk_app;
ALTER DEFAULT PRIVILEGES FOR ROLE voicedesk_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO voicedesk_app;
ALTER DEFAULT PRIVILEGES FOR ROLE voicedesk_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO voicedesk_app;

\connect voicedesk_test
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;
GRANT USAGE ON SCHEMA public TO voicedesk_app;
ALTER DEFAULT PRIVILEGES FOR ROLE voicedesk_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO voicedesk_app;
ALTER DEFAULT PRIVILEGES FOR ROLE voicedesk_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO voicedesk_app;
