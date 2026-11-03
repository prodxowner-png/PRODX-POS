-- 0038: restrict PRODX public objects to the server-side runtime role.
-- Supabase defaults grant public-schema objects to API roles. PRODX is accessed
-- through the authenticated backend only; the browser must not use table/RPC access.
DO $$
DECLARE
  object_name text;
  object_signature text;
  role_name text;
BEGIN
  FOR object_name IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND left(c.relname, 6) = 'prodx_'
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', object_name);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', object_name, role_name);
      END IF;
    END LOOP;
  END LOOP;

  FOR object_name IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'S' AND left(c.relname, 6) = 'prodx_'
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM PUBLIC', object_name);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM %I', object_name, role_name);
      END IF;
    END LOOP;
  END LOOP;

  FOR object_signature IN
    SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND left(p.proname, 6) = 'prodx_'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', object_signature);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', object_signature, role_name);
      END IF;
    END LOOP;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO prodx_app', object_signature);
  END LOOP;
END
$$;

-- Internal tables are migration-runner-only, not runtime or PostgREST objects.
REVOKE ALL PRIVILEGES ON TABLE public.prodx_schema_migrations, public.prodx_migration_lock, public.prodx_auth_login_throttles FROM prodx_app;
ALTER TABLE public.prodx_schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prodx_migration_lock ENABLE ROW LEVEL SECURITY;

INSERT INTO public.prodx_schema_migrations(version)
VALUES ('0038_security_restrict_public_api_roles')
ON CONFLICT (version) DO NOTHING;
