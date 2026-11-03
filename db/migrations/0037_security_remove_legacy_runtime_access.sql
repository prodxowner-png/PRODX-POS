-- 0037: forward repair for databases that already recorded the legacy 0033 grants/policies.
-- Remove only the legacy policy created by 0033 for prodx_app, never unrelated app policies.
-- Revoke this role's access to non-PRODX public objects and restore PRODX sequence access only.
-- Do not automatically DISABLE RLS on non-PRODX tables: after a legacy 0034 run,
-- PostgreSQL does not retain the prior relrowsecurity value. Restoring it blindly could
-- weaken an application's intentional RLS. Shared-table owners must verify intended RLS
-- and policies from backups, migration history, or owner-approved schema records.
DO $$
DECLARE
  app_role_oid oid;
  policy_row record;
  object_name text;
  sequence_name text;
BEGIN
  SELECT oid INTO app_role_oid FROM pg_roles WHERE rolname = 'prodx_app';
  IF app_role_oid IS NULL THEN
    RAISE EXCEPTION 'prodx_app role is required for legacy privilege cleanup';
  END IF;

  -- Verify role flags instead of ALTER ROLE: hosted Supabase migrations run
  -- without true SUPERUSER and cannot change SUPERUSER/BYPASSRLS attributes.
  IF EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'prodx_app'
       AND (NOT rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb
         OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'prodx_app role must remain least-privileged';
  END IF;

  FOR policy_row IN
    SELECT n.nspname, c.relname, p.polname
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND p.polname = 'prodx_app_runtime_access'
       AND p.polroles = ARRAY[app_role_oid]
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', policy_row.polname, policy_row.nspname, policy_row.relname);
  END LOOP;

  FOR object_name IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND left(c.relname, 6) <> 'prodx_'
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM prodx_app', object_name);
  END LOOP;

  REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public FROM prodx_app;
  FOR sequence_name IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'S'
       AND left(c.relname, 6) = 'prodx_'
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO prodx_app', sequence_name);
  END LOOP;
END
$$;

-- Converge upgrades that already recorded 0036 with the old unconditional global-catalog policy.
-- prodx_permissions is global reference data; its schema CHECK constraint guarantees a nonblank key.
DROP POLICY IF EXISTS prodx_app_global_permissions_read ON public.prodx_permissions;
CREATE POLICY prodx_app_global_permissions_read ON public.prodx_permissions
  FOR SELECT TO prodx_app
  USING (permission_key IS NOT NULL AND length(btrim(permission_key)) > 0);
REVOKE INSERT, UPDATE, DELETE ON TABLE public.prodx_permissions FROM prodx_app;
GRANT SELECT ON TABLE public.prodx_permissions TO prodx_app;

-- Remove legacy default grants from the migration owner for both global and public-schema objects.
ALTER DEFAULT PRIVILEGES
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM prodx_app;
ALTER DEFAULT PRIVILEGES
  REVOKE USAGE, SELECT ON SEQUENCES FROM prodx_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM prodx_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM prodx_app;

INSERT INTO prodx_schema_migrations(version)
VALUES ('0037_security_remove_legacy_runtime_access')
ON CONFLICT(version) DO NOTHING;
