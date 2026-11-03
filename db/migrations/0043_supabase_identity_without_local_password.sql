-- 0043: Supabase Auth is the password verifier for explicitly linked identities.
-- Resolve only the POS principal and active device scope; do not require or expose
-- a synthetic local password credential for an external Supabase identity.
CREATE OR REPLACE FUNCTION public.prodx_auth_find_user_by_supabase_user_id(
  p_supabase_user_id uuid,
  p_device_id uuid
)
RETURNS TABLE(
  "userId" uuid,
  "organizationId" uuid,
  username text,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT u.id, u.organization_id, u.username, u.status
    FROM public.prodx_devices d
    JOIN public.prodx_users u ON u.organization_id = d.organization_id
   WHERE d.id = p_device_id
     AND d.status = 'active'
     AND u.supabase_auth_user_id = p_supabase_user_id
   ORDER BY u.id
   LIMIT 1
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.prodx_auth_find_user_by_supabase_user_id(uuid, uuid) FROM PUBLIC;
DO $privileges$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.prodx_auth_find_user_by_supabase_user_id(uuid, uuid) FROM %I', role_name);
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prodx_app') THEN
    RAISE EXCEPTION 'Required runtime role prodx_app is missing';
  END IF;
END
$privileges$;
GRANT EXECUTE ON FUNCTION public.prodx_auth_find_user_by_supabase_user_id(uuid, uuid) TO prodx_app;

INSERT INTO public.prodx_schema_migrations(version)
VALUES ('0043_supabase_identity_without_local_password')
ON CONFLICT (version) DO NOTHING;
