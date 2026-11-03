-- 0050: safely renew an existing POS session after server verification of a fresh Supabase JWT.
-- This migration follows the 0044-0049 database/index sequence introduced by PR #340.
-- The existing POS bearer remains hashed and stable. Expired/revoked sessions cannot be revived.
CREATE OR REPLACE FUNCTION public.prodx_auth_renew_supabase_session(
  p_session_id uuid,
  p_token_hash text,
  p_supabase_user_id uuid,
  p_expires_at timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  renewed_expiry timestamptz;
BEGIN
  IF p_expires_at IS NULL
     OR p_expires_at <= CURRENT_TIMESTAMP
     OR p_expires_at > CURRENT_TIMESTAMP + INTERVAL '8 hours' THEN
    RETURN NULL;
  END IF;

  UPDATE public.prodx_sessions AS ses
     SET expires_at = GREATEST(ses.expires_at, p_expires_at)
    FROM public.prodx_users AS u
    JOIN public.prodx_devices AS d ON d.organization_id = u.organization_id
    JOIN public.prodx_stores AS s ON s.id = d.store_id AND s.organization_id = d.organization_id
    JOIN public.prodx_store_memberships AS m
      ON m.organization_id = u.organization_id
     AND m.store_id = d.store_id
     AND m.user_id = u.id
     AND m.active = TRUE
   WHERE ses.id = p_session_id
     AND ses.token_hash = p_token_hash
     AND ses.revoked_at IS NULL
     AND ses.expires_at > CURRENT_TIMESTAMP
     AND ses.user_id = u.id
     AND ses.organization_id = u.organization_id
     AND u.supabase_auth_user_id = p_supabase_user_id
     AND u.status = 'active'
     AND d.id = ses.device_id
     AND d.status = 'active'
     AND s.active = TRUE
  RETURNING ses.expires_at INTO renewed_expiry;

  RETURN renewed_expiry;
END
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.prodx_auth_renew_supabase_session(uuid, text, uuid, timestamptz) FROM PUBLIC;
DO $privileges$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON FUNCTION public.prodx_auth_renew_supabase_session(uuid, text, uuid, timestamptz) FROM %I',
        role_name
      );
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prodx_app') THEN
    RAISE EXCEPTION 'Required runtime role prodx_app is missing';
  END IF;
END
$privileges$;
GRANT EXECUTE ON FUNCTION public.prodx_auth_renew_supabase_session(uuid, text, uuid, timestamptz) TO prodx_app;

INSERT INTO public.prodx_schema_migrations(version)
VALUES ('0050_m8_supabase_pos_session_renewal')
ON CONFLICT (version) DO NOTHING;
