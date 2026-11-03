-- Dedicated backend runtime role for PRODX-POS.
-- Tenant/store isolation is enforced by the fail-closed policies in migration 0036.
-- This migration deliberately installs no permissive policy; access remains fail-closed once RLS is enabled.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prodx_app') THEN
    -- PostgreSQL defaults privilege-escalating role flags to false. Hosted
    -- Supabase migration connections are not true superusers and cannot set
    -- SUPERUSER/BYPASSRLS attributes, even when explicitly setting them false.
    CREATE ROLE prodx_app WITH LOGIN NOINHERIT;
  END IF;
END
$$;

-- Fail closed if an existing role is not least-privileged; never attempt a
-- superuser-only ALTER ROLE from a hosted Supabase migration connection.
DO $$
DECLARE
  role_flags record;
BEGIN
  SELECT rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
         rolreplication, rolbypassrls
    INTO role_flags
    FROM pg_roles
   WHERE rolname = 'prodx_app';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'prodx_app role was not created';
  END IF;

  IF NOT role_flags.rolcanlogin
     OR role_flags.rolinherit
     OR role_flags.rolsuper
     OR role_flags.rolcreatedb
     OR role_flags.rolcreaterole
     OR role_flags.rolreplication
     OR role_flags.rolbypassrls THEN
    RAISE EXCEPTION 'prodx_app role must be LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  END IF;
END
$$;

COMMENT ON ROLE prodx_app IS
  'PRODX-POS backend runtime role. Tenant/store access is constrained by explicit RLS policies and server-verified request context.';

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO prodx_app', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO prodx_app;

-- Grant table privileges only to PRODX-owned application tables.
DO $tables$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname LIKE 'prodx\_%' ESCAPE '\'
      AND c.relname NOT IN ('prodx_schema_migrations', 'prodx_migration_lock')
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO prodx_app', table_name);
  END LOOP;
END
$tables$;

REVOKE ALL
  ON TABLE public.prodx_schema_migrations, public.prodx_migration_lock
  FROM prodx_app;

-- Grant sequence access only to PRODX-owned sequences.
DO $seq$
DECLARE
  sequence_name text;
BEGIN
  FOR sequence_name IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND c.relname LIKE 'prodx\_%' ESCAPE '\'
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO prodx_app', sequence_name);
  END LOOP;
END
$seq$;

-- RLS policies are created by migration 0036 after tenant/store scope is classified.
-- Until then, enabled RLS remains fail-closed; no USING (true) / WITH CHECK (true) policy is installed.

-- Future tables/sequences must not inherit runtime privileges automatically.
ALTER DEFAULT PRIVILEGES
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM prodx_app;
ALTER DEFAULT PRIVILEGES
  REVOKE USAGE, SELECT ON SEQUENCES FROM prodx_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM prodx_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM prodx_app;

INSERT INTO prodx_schema_migrations(version)
VALUES ('0033_security_prodx_app_role')
ON CONFLICT(version) DO NOTHING;
