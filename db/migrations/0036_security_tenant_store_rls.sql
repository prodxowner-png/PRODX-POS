-- 0036: enforce tenant/store RLS and move pre-auth database access behind narrow functions.
-- The application role must not have broad policies on tenant-scoped tables.
-- Only PRODX-owned public tables are classified; shared tables owned by other applications are untouched.
-- Authentication bootstrap functions are SECURITY DEFINER with a fixed search_path;
-- they expose only the columns/operations required before an authenticated principal exists.

CREATE OR REPLACE FUNCTION public.prodx_auth_resolve_device(
  p_organization_code text,
  p_store_code text,
  p_device_key text
)
RETURNS TABLE(id uuid, store_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT d.id, d.store_id
    FROM public.prodx_organizations o
    JOIN public.prodx_stores s ON s.organization_id = o.id
    JOIN public.prodx_devices d ON d.organization_id = o.id AND d.store_id = s.id
   WHERE lower(o.code) = lower(p_organization_code)
     AND lower(s.code) = lower(p_store_code)
     AND d.device_key = p_device_key
     AND d.status = 'active'
     AND s.active = TRUE
   LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.prodx_auth_find_device(p_device_id uuid)
RETURNS TABLE(id uuid, organization_id uuid, store_id uuid, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT d.id, d.organization_id, d.store_id, d.status
    FROM public.prodx_devices d
   WHERE d.id = p_device_id
   LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.prodx_auth_find_credential_by_username(
  p_username text,
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
     AND lower(u.username) = lower(p_username)
   ORDER BY u.organization_id
   LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.prodx_auth_record_failed_attempt(
  p_user_id uuid,
  p_organization_id uuid,
  p_audit_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  WITH updated AS (
    UPDATE public.prodx_user_credentials c
       SET failed_attempts = LEAST(c.failed_attempts + 1, 5),
           locked_until = CASE
             WHEN c.failed_attempts + 1 >= 5
               THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes'
             ELSE c.locked_until
           END,
           updated_at = CURRENT_TIMESTAMP
      FROM public.prodx_users u
     WHERE c.user_id = p_user_id
       AND u.id = c.user_id
       AND u.organization_id = p_organization_id
       AND (c.locked_until IS NULL OR c.locked_until <= CURRENT_TIMESTAMP)
    RETURNING c.user_id, c.failed_attempts, c.locked_until
  )
  INSERT INTO public.prodx_security_audit_events
    (id, organization_id, user_id, event_type, metadata)
  SELECT p_audit_id, p_organization_id, updated.user_id, 'AUTH_LOCKOUT',
         jsonb_build_object('failed_attempts', updated.failed_attempts, 'locked_until', updated.locked_until)
    FROM updated
   WHERE updated.failed_attempts = 5
     AND updated.locked_until IS NOT NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prodx_auth_reset_failed_attempts(
  p_user_id uuid,
  p_organization_id uuid,
  p_audit_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  WITH previous AS (
    SELECT c.user_id, c.failed_attempts, c.locked_until
      FROM public.prodx_user_credentials c
      JOIN public.prodx_users u ON u.id = c.user_id
     WHERE c.user_id = p_user_id
       AND u.organization_id = p_organization_id
     FOR UPDATE OF c
  ),
  updated AS (
    UPDATE public.prodx_user_credentials c
       SET failed_attempts = 0,
           locked_until = NULL,
           last_authenticated_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
      FROM previous
     WHERE c.user_id = previous.user_id
    RETURNING c.user_id
  )
  INSERT INTO public.prodx_security_audit_events
    (id, organization_id, user_id, event_type, metadata)
  SELECT p_audit_id, p_organization_id, previous.user_id, 'AUTH_LOCKOUT_RESET',
         jsonb_build_object(
           'previous_failed_attempts', previous.failed_attempts,
           'previous_locked_until', previous.locked_until
         )
    FROM previous
    JOIN updated USING (user_id)
   WHERE previous.failed_attempts > 0
      OR previous.locked_until IS NOT NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prodx_auth_create_session(
  p_id uuid,
  p_organization_id uuid,
  p_user_id uuid,
  p_device_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_expires_at <= CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'authentication session expiry must be in the future'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.prodx_users u
      JOIN public.prodx_devices d ON d.organization_id = u.organization_id
      JOIN public.prodx_stores s ON s.id = d.store_id AND s.organization_id = d.organization_id
      JOIN public.prodx_store_memberships m
        ON m.organization_id = u.organization_id
       AND m.store_id = d.store_id
       AND m.user_id = u.id
       AND m.active = TRUE
     WHERE u.id = p_user_id
       AND u.organization_id = p_organization_id
       AND u.status = 'active'
       AND d.id = p_device_id
       AND d.status = 'active'
       AND s.active = TRUE
  ) THEN
    RAISE EXCEPTION 'authentication session scope is invalid'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.prodx_sessions
    (id, organization_id, user_id, device_id, token_hash, expires_at)
  VALUES
    (p_id, p_organization_id, p_user_id, p_device_id, p_token_hash, p_expires_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public.prodx_auth_find_session_by_token_hash(p_token_hash text)
RETURNS TABLE(
  id uuid,
  organization_id uuid,
  user_id uuid,
  device_id uuid,
  token_hash text,
  expires_at timestamptz,
  revoked_at timestamptz,
  user_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT s.id, s.organization_id, s.user_id, s.device_id, s.token_hash,
         s.expires_at, s.revoked_at, u.status
    FROM public.prodx_sessions s
    JOIN public.prodx_users u ON u.id = s.user_id AND u.organization_id = s.organization_id
   WHERE s.token_hash = p_token_hash
   LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.prodx_auth_revoke_session(
  p_session_id uuid,
  p_token_hash text,
  p_at timestamptz
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  UPDATE public.prodx_sessions
     SET revoked_at = p_at
   WHERE id = p_session_id
     AND token_hash = p_token_hash
     AND revoked_at IS NULL
$function$;

CREATE OR REPLACE FUNCTION public.prodx_auth_touch_session(
  p_session_id uuid,
  p_token_hash text,
  p_at timestamptz
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  UPDATE public.prodx_sessions
     SET last_seen_at = p_at
   WHERE id = p_session_id
     AND token_hash = p_token_hash
     AND revoked_at IS NULL
     AND expires_at > p_at
$function$;

CREATE OR REPLACE FUNCTION public.prodx_auth_login_throttle_check(
  p_client_fingerprint text,
  p_now timestamptz
)
RETURNS TABLE(failed_attempts integer, window_started_at timestamptz, locked_until timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_row public.prodx_auth_login_throttles%ROWTYPE;
BEGIN
  SELECT t.*
    INTO v_row
    FROM public.prodx_auth_login_throttles t
   WHERE t.client_fingerprint = p_client_fingerprint
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_row.window_started_at + INTERVAL '10 minutes' <= p_now THEN
    UPDATE public.prodx_auth_login_throttles t
       SET failed_attempts = 0,
           window_started_at = p_now,
           locked_until = NULL,
           updated_at = p_now
     WHERE t.client_fingerprint = p_client_fingerprint
    RETURNING t.* INTO v_row;
  END IF;

  RETURN QUERY SELECT v_row.failed_attempts, v_row.window_started_at, v_row.locked_until;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prodx_auth_login_throttle_record_failure(
  p_client_fingerprint text,
  p_now timestamptz
)
RETURNS TABLE(failed_attempts integer, locked_until timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  INSERT INTO public.prodx_auth_login_throttles
    (client_fingerprint, failed_attempts, window_started_at, locked_until, updated_at)
  VALUES (p_client_fingerprint, 1, p_now, NULL, p_now)
  ON CONFLICT (client_fingerprint) DO UPDATE
    SET failed_attempts = CASE
          WHEN public.prodx_auth_login_throttles.window_started_at + INTERVAL '10 minutes' <= p_now
            THEN 1 ELSE public.prodx_auth_login_throttles.failed_attempts + 1 END,
        window_started_at = CASE
          WHEN public.prodx_auth_login_throttles.window_started_at + INTERVAL '10 minutes' <= p_now
            THEN p_now ELSE public.prodx_auth_login_throttles.window_started_at END,
        locked_until = CASE
          WHEN public.prodx_auth_login_throttles.window_started_at + INTERVAL '10 minutes' <= p_now
            THEN NULL
          WHEN public.prodx_auth_login_throttles.failed_attempts + 1 >= 20
            THEN p_now + INTERVAL '1 minute'
          ELSE public.prodx_auth_login_throttles.locked_until END,
        updated_at = p_now
  RETURNING failed_attempts, locked_until
$function$;

DROP FUNCTION IF EXISTS public.prodx_auth_list_member_stores();

CREATE OR REPLACE FUNCTION public.prodx_auth_list_member_stores(p_organization_code text)
RETURNS TABLE(id uuid, organization_id uuid, code text, name text, business_timezone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT s.id, s.organization_id, s.code, s.name, s.business_timezone
    FROM public.prodx_stores s
    JOIN public.prodx_store_memberships m
      ON m.organization_id = s.organization_id
     AND m.store_id = s.id
     AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
     AND m.active = TRUE
   JOIN public.prodx_organizations o ON o.id = s.organization_id
   WHERE s.organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
     AND lower(o.code) = lower(p_organization_code)
     AND s.active = TRUE
   ORDER BY s.code
$function$;

-- Remove policies that apply to the runtime role directly or through PUBLIC,
-- then create an explicit fail-closed policy for each classified table.
DO $$
DECLARE
  app_role_oid oid;
  table_row record;
  policy_row record;
  scope_expression text;
BEGIN
  SELECT oid INTO app_role_oid FROM pg_roles WHERE rolname = 'prodx_app';
  IF app_role_oid IS NULL THEN
    RAISE EXCEPTION 'prodx_app role is required before tenant RLS can be enabled';
  END IF;

  FOR table_row IN
    SELECT c.relname,
           bool_or(a.attname = 'organization_id') AS has_organization_id,
           bool_or(a.attname = 'store_id') AS has_store_id
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname LIKE 'prodx\_%' ESCAPE '\'
       AND c.relname NOT IN ('prodx_schema_migrations', 'prodx_migration_lock')
     GROUP BY c.relname
  LOOP
    FOR policy_row IN
      SELECT polname
        FROM pg_policy
       WHERE polrelid = format('public.%I', table_row.relname)::regclass
         AND (polroles @> ARRAY[0::oid] OR polroles @> ARRAY[app_role_oid])
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_row.polname, table_row.relname);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_row.relname);

    IF table_row.relname = 'prodx_permissions' THEN
      REVOKE INSERT, UPDATE, DELETE ON public.prodx_permissions FROM prodx_app;
      -- This is global reference data (permission key + description), not tenant data.
      -- Keep the policy explicit and aligned with prodx_permissions' nonblank-key CHECK constraint.
      EXECUTE 'CREATE POLICY prodx_app_global_permissions_read ON public.prodx_permissions FOR SELECT TO prodx_app USING (permission_key IS NOT NULL AND length(btrim(permission_key)) > 0)';
      CONTINUE;
    ELSIF table_row.relname = 'prodx_auth_login_throttles' THEN
      -- The table is internal operational state; only the narrow SECURITY DEFINER
      -- throttle functions below may read or mutate it.
      CONTINUE;
    ELSIF table_row.relname = 'prodx_organizations' THEN
      scope_expression := 'id = NULLIF(current_setting(''app.organization_id'', true), '''')::uuid';
    ELSIF table_row.relname = 'prodx_stores' THEN
      scope_expression := 'organization_id = NULLIF(current_setting(''app.organization_id'', true), '''')::uuid AND id = NULLIF(current_setting(''app.store_id'', true), '''')::uuid';
    ELSIF table_row.relname = 'prodx_user_credentials' THEN
      scope_expression := 'EXISTS (SELECT 1 FROM public.prodx_users u WHERE u.id = user_id AND u.organization_id = NULLIF(current_setting(''app.organization_id'', true), '''')::uuid)';
    ELSIF table_row.relname = 'prodx_sessions' THEN
      scope_expression := 'organization_id = NULLIF(current_setting(''app.organization_id'', true), '''')::uuid AND user_id = NULLIF(current_setting(''app.user_id'', true), '''')::uuid AND EXISTS (SELECT 1 FROM public.prodx_devices d WHERE d.id = device_id AND d.organization_id = NULLIF(current_setting(''app.organization_id'', true), '''')::uuid AND d.store_id = NULLIF(current_setting(''app.store_id'', true), '''')::uuid)';
    ELSIF table_row.relname = 'prodx_security_audit_events' THEN
      scope_expression := 'organization_id = NULLIF(current_setting(''app.organization_id'', true), '''')::uuid';
    ELSIF table_row.has_organization_id AND table_row.has_store_id THEN
      scope_expression := 'organization_id = NULLIF(current_setting(''app.organization_id'', true), '''')::uuid AND store_id = NULLIF(current_setting(''app.store_id'', true), '''')::uuid';
    ELSIF table_row.has_organization_id THEN
      scope_expression := 'organization_id = NULLIF(current_setting(''app.organization_id'', true), '''')::uuid';
    ELSE
      RAISE EXCEPTION 'Unclassified public table % cannot be assigned a tenant RLS policy', table_row.relname;
    END IF;

    EXECUTE format(
      'CREATE POLICY prodx_app_tenant_isolation ON public.%I FOR ALL TO prodx_app USING (%s) WITH CHECK (%s)',
      table_row.relname,
      scope_expression,
      scope_expression
    );
  END LOOP;
END
$$;

-- Pre-authentication and internal state are callable only through the fixed functions.
REVOKE ALL ON TABLE public.prodx_user_credentials, public.prodx_auth_login_throttles FROM PUBLIC;
REVOKE ALL ON TABLE public.prodx_user_credentials, public.prodx_auth_login_throttles FROM prodx_app;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.prodx_sessions, public.prodx_security_audit_events FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.prodx_sessions, public.prodx_security_audit_events FROM prodx_app;
GRANT SELECT ON TABLE public.prodx_sessions, public.prodx_security_audit_events, public.prodx_permissions TO prodx_app;
-- Remove legacy grants from every sequence, then restore access only to PRODX-owned sequences.
REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public FROM prodx_app;
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
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM prodx_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM prodx_app;

REVOKE ALL ON FUNCTION public.prodx_auth_resolve_device(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prodx_auth_find_device(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prodx_auth_find_credential_by_username(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prodx_auth_record_failed_attempt(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prodx_auth_reset_failed_attempts(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prodx_auth_create_session(uuid, uuid, uuid, uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prodx_auth_find_session_by_token_hash(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prodx_auth_revoke_session(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prodx_auth_touch_session(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prodx_auth_login_throttle_check(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prodx_auth_login_throttle_record_failure(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prodx_auth_list_member_stores(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.prodx_auth_resolve_device(text, text, text) TO prodx_app;
GRANT EXECUTE ON FUNCTION public.prodx_auth_find_device(uuid) TO prodx_app;
GRANT EXECUTE ON FUNCTION public.prodx_auth_find_credential_by_username(text, uuid) TO prodx_app;
GRANT EXECUTE ON FUNCTION public.prodx_auth_record_failed_attempt(uuid, uuid, uuid) TO prodx_app;
GRANT EXECUTE ON FUNCTION public.prodx_auth_reset_failed_attempts(uuid, uuid, uuid) TO prodx_app;
GRANT EXECUTE ON FUNCTION public.prodx_auth_create_session(uuid, uuid, uuid, uuid, text, timestamptz) TO prodx_app;
GRANT EXECUTE ON FUNCTION public.prodx_auth_find_session_by_token_hash(text) TO prodx_app;
GRANT EXECUTE ON FUNCTION public.prodx_auth_revoke_session(uuid, text, timestamptz) TO prodx_app;
GRANT EXECUTE ON FUNCTION public.prodx_auth_touch_session(uuid, text, timestamptz) TO prodx_app;
GRANT EXECUTE ON FUNCTION public.prodx_auth_login_throttle_check(text, timestamptz) TO prodx_app;
GRANT EXECUTE ON FUNCTION public.prodx_auth_login_throttle_record_failure(text, timestamptz) TO prodx_app;
GRANT EXECUTE ON FUNCTION public.prodx_auth_list_member_stores(text) TO prodx_app;

INSERT INTO prodx_schema_migrations(version)
VALUES ('0036_security_tenant_store_rls')
ON CONFLICT(version) DO NOTHING;
