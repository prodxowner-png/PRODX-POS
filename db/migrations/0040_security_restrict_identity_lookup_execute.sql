-- 0040: restrict the Supabase identity lookup RPC to the trusted backend role.
-- Migration 0039 created a SECURITY DEFINER function with public in its search_path;
-- every table reference is schema-qualified, so use pg_catalog only.
DO $preflight$
BEGIN
  IF to_regprocedure('public.prodx_auth_find_credential_by_supabase_user_id(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Required function public.prodx_auth_find_credential_by_supabase_user_id(uuid, uuid) is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prodx_app') THEN
    RAISE EXCEPTION 'Required runtime role prodx_app is missing';
  END IF;
END
$preflight$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.prodx_auth_find_credential_by_supabase_user_id(uuid, uuid)
  FROM PUBLIC;

DO $security$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON FUNCTION public.prodx_auth_find_credential_by_supabase_user_id(uuid, uuid) FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$security$;

GRANT EXECUTE
  ON FUNCTION public.prodx_auth_find_credential_by_supabase_user_id(uuid, uuid)
  TO prodx_app;

ALTER FUNCTION public.prodx_auth_find_credential_by_supabase_user_id(uuid, uuid)
  SET search_path = pg_catalog;

INSERT INTO public.prodx_schema_migrations(version)
VALUES ('0040_security_restrict_identity_lookup_execute')
ON CONFLICT (version) DO NOTHING;
