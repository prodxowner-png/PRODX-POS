-- 0059: safely renew an existing POS session after server verification of a fresh Supabase JWT.
-- This migration follows the trusted mainline through migration 0058.
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
  locked_session_id uuid;
  locked_expiry timestamptz;
  renewed_expiry timestamptz;
  renewed_user_id uuid;
  renewed_organization_id uuid;
BEGIN
  -- CURRENT_TIMESTAMP is fixed at transaction start. Validate against wall-clock
  -- time both before and after row locks so a lock wait cannot revive an expired JWT.
  IF p_expires_at IS NULL
     OR p_expires_at <= clock_timestamp()
     OR p_expires_at > clock_timestamp() + INTERVAL '8 hours' THEN
    RETURN NULL;
  END IF;

  -- Serialize renewal against revocation and user/device/store/membership changes.
  -- If another transaction wins a lock, PostgreSQL rechecks the predicates after it commits.
  SELECT ses.id, ses.expires_at, ses.user_id, ses.organization_id
    INTO locked_session_id, locked_expiry, renewed_user_id, renewed_organization_id
    FROM public.prodx_sessions AS ses
    JOIN public.prodx_users AS u
      ON u.id = ses.user_id AND u.organization_id = ses.organization_id
    JOIN public.prodx_devices AS d
      ON d.id = ses.device_id AND d.organization_id = ses.organization_id
    JOIN public.prodx_stores AS s
      ON s.id = d.store_id AND s.organization_id = d.organization_id
    JOIN public.prodx_store_memberships AS m
      ON m.organization_id = u.organization_id
     AND m.store_id = d.store_id
     AND m.user_id = u.id
     AND m.active = TRUE
   WHERE ses.id = p_session_id
     AND ses.token_hash = p_token_hash
     AND ses.revoked_at IS NULL
     AND ses.user_id = u.id
     AND ses.organization_id = u.organization_id
     AND u.supabase_auth_user_id = p_supabase_user_id
     AND u.status = 'active'
     AND d.status = 'active'
     AND s.active = TRUE
   FOR UPDATE OF ses, u, d, s, m;

  -- Recheck both expiries after acquiring every authority-bearing row lock.
  IF NOT FOUND
     OR locked_expiry <= clock_timestamp()
     OR p_expires_at <= clock_timestamp() THEN
    RETURN NULL;
  END IF;

  UPDATE public.prodx_sessions AS ses
     SET expires_at = GREATEST(ses.expires_at, p_expires_at)
   WHERE ses.id = locked_session_id
     AND ses.token_hash = p_token_hash
     AND ses.revoked_at IS NULL
     AND ses.expires_at > clock_timestamp()
     AND p_expires_at > clock_timestamp()
  RETURNING ses.expires_at INTO renewed_expiry;

  -- Record the security event in the same transaction as the successful renewal.
  -- A rejected/expired/revoked session returns NULL and produces no audit row.
  IF renewed_expiry IS NOT NULL THEN
    INSERT INTO public.prodx_security_audit_events
      (id, organization_id, user_id, event_type, metadata)
    VALUES (
      gen_random_uuid(),
      renewed_organization_id,
      renewed_user_id,
      'POS_SESSION_RENEWED',
      jsonb_build_object(
        'session_id', p_session_id,
        'expires_at', renewed_expiry
      )
    );
  END IF;

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
VALUES ('0064_supabase_pos_session_renewal')
ON CONFLICT (version) DO NOTHING;
