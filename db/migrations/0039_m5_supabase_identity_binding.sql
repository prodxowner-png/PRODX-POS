-- Bind POS staff accounts to an explicit Supabase Auth subject.
-- Do not auto-link existing accounts by email: an operator must provision each link.
ALTER TABLE public.prodx_users
  ADD COLUMN IF NOT EXISTS supabase_auth_user_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS prodx_users_supabase_auth_user_id_unique
  ON public.prodx_users (supabase_auth_user_id)
  WHERE supabase_auth_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prodx_auth_find_credential_by_supabase_user_id(
  p_supabase_user_id uuid,
  p_device_id uuid
)
RETURNS TABLE(
  "userId" uuid,
  "organizationId" uuid,
  username text,
  status text,
  credential_type text,
  secret_hash text,
  failed_attempts integer,
  locked_until timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT u.id, u.organization_id, u.username, u.status,
         c.credential_type, c.secret_hash, c.failed_attempts, c.locked_until
    FROM public.prodx_devices d
    JOIN public.prodx_users u ON u.organization_id = d.organization_id
    JOIN public.prodx_user_credentials c ON c.user_id = u.id
   WHERE d.id = p_device_id
     AND d.status = 'active'
     AND u.supabase_auth_user_id = p_supabase_user_id
     -- The application contract is a password credential; never resolve another credential type
     -- non-deterministically when a user holds several.
     AND c.credential_type = 'password'
   ORDER BY u.id, c.credential_type
   LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.prodx_auth_find_credential_by_supabase_user_id(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prodx_auth_find_credential_by_supabase_user_id(uuid, uuid) TO prodx_app;

INSERT INTO prodx_schema_migrations (version)
VALUES ('0039_m5_supabase_identity_binding')
ON CONFLICT (version) DO NOTHING;
