-- 0047: supervisor authorization credential access for the least-privileged runtime role.
--
-- prodx_app has no table privileges on public.prodx_user_credentials (0036).
-- Supervisor step-up authorization (refund/void) therefore reaches credential
-- state only through these narrow SECURITY DEFINER RPCs. Every RPC:
--   * pins search_path to pg_catalog and schema-qualifies every object;
--   * fails closed unless the caller-supplied organization/store exactly match
--     the transaction-local, server-verified tenant context (app.organization_id,
--     app.store_id) and an authenticated requester (app.user_id) is present;
--   * only touches the credential of a user inside that organization.
-- Forward-only and idempotent: CREATE OR REPLACE plus explicit REVOKE/GRANT.

CREATE OR REPLACE FUNCTION public.prodx_supervisor_find_credential(
  p_organization_id uuid,
  p_store_id uuid,
  p_identifier text
)
RETURNS TABLE (
  supervisor_user_id uuid,
  user_status text,
  secret_hash text,
  failed_attempts integer,
  locked_until timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
#variable_conflict use_column
DECLARE
  v_identifier text := pg_catalog.btrim(COALESCE(p_identifier, ''));
BEGIN
  IF p_organization_id IS NULL
     OR p_store_id IS NULL
     OR p_organization_id IS DISTINCT FROM NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::uuid
     OR p_store_id IS DISTINCT FROM NULLIF(pg_catalog.current_setting('app.store_id', true), '')::uuid
     OR NULLIF(pg_catalog.current_setting('app.user_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'supervisor credential lookup is outside the authenticated tenant context'
      USING ERRCODE = '42501';
  END IF;

  IF v_identifier = '' OR pg_catalog.length(v_identifier) > 320 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT u.id, u.status, c.secret_hash, c.failed_attempts, c.locked_until
    FROM public.prodx_users u
    JOIN public.prodx_user_credentials c ON c.user_id = u.id
   WHERE u.organization_id = p_organization_id
     AND (u.id::text = v_identifier OR pg_catalog.lower(u.username) = pg_catalog.lower(v_identifier))
   ORDER BY (u.id::text = v_identifier) DESC
   LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prodx_supervisor_record_failed_attempt(
  p_organization_id uuid,
  p_store_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_organization_id IS NULL
     OR p_store_id IS NULL
     OR p_user_id IS NULL
     OR p_organization_id IS DISTINCT FROM NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::uuid
     OR p_store_id IS DISTINCT FROM NULLIF(pg_catalog.current_setting('app.store_id', true), '')::uuid
     OR NULLIF(pg_catalog.current_setting('app.user_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'supervisor failed-attempt update is outside the authenticated tenant context'
      USING ERRCODE = '42501';
  END IF;

  -- Single atomic UPDATE: concurrent failures serialize on the credential row
  -- and cannot overwrite one another's count. Lockout policy matches the
  -- primary login path (5 attempts, 15 minutes, database clock).
  UPDATE public.prodx_user_credentials c
     SET failed_attempts = LEAST(c.failed_attempts + 1, 5),
         locked_until = CASE
           WHEN c.failed_attempts + 1 >= 5 THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes'
           ELSE c.locked_until
         END,
         updated_at = CURRENT_TIMESTAMP
    FROM public.prodx_users u
   WHERE c.user_id = p_user_id
     AND u.id = c.user_id
     AND u.organization_id = p_organization_id
     AND (c.locked_until IS NULL OR c.locked_until <= CURRENT_TIMESTAMP);
END;
$function$;

CREATE OR REPLACE FUNCTION public.prodx_supervisor_reset_failed_attempts(
  p_organization_id uuid,
  p_store_id uuid,
  p_user_id uuid,
  p_action text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_permission_key text;
BEGIN
  IF p_organization_id IS NULL
     OR p_store_id IS NULL
     OR p_user_id IS NULL
     OR p_organization_id IS DISTINCT FROM NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::uuid
     OR p_store_id IS DISTINCT FROM NULLIF(pg_catalog.current_setting('app.store_id', true), '')::uuid
     OR NULLIF(pg_catalog.current_setting('app.user_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'supervisor failed-attempt reset is outside the authenticated tenant context'
      USING ERRCODE = '42501';
  END IF;

  v_permission_key := CASE p_action WHEN 'refund' THEN 'pos.refund' WHEN 'void' THEN 'pos.void' END;
  IF v_permission_key IS NULL THEN
    RAISE EXCEPTION 'supervisor action is invalid' USING ERRCODE = '22023';
  END IF;

  -- A reset is only legitimate for an active supervisor who actually holds the
  -- requested store-scoped permission; this prevents the runtime role from
  -- clearing lockouts of arbitrary organization users.
  IF NOT EXISTS (
    SELECT 1
      FROM public.prodx_users u
      JOIN public.prodx_store_memberships m
        ON m.organization_id = u.organization_id AND m.user_id = u.id
       AND m.store_id = p_store_id AND m.active = TRUE
      JOIN public.prodx_user_roles ur
        ON ur.organization_id = m.organization_id AND ur.user_id = m.user_id
       AND ur.store_id = m.store_id AND ur.active = TRUE
      JOIN public.prodx_roles r
        ON r.id = ur.role_id AND r.organization_id = ur.organization_id AND r.active = TRUE
      JOIN public.prodx_role_permissions rp
        ON rp.organization_id = r.organization_id AND rp.role_id = r.id
      JOIN public.prodx_permissions p
        ON p.id = rp.permission_id AND p.permission_key = v_permission_key
     WHERE u.id = p_user_id
       AND u.organization_id = p_organization_id
       AND u.status = 'active'
  ) THEN
    RAISE EXCEPTION 'supervisor is not eligible for the requested store permission'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.prodx_user_credentials c
     SET failed_attempts = 0,
         locked_until = NULL,
         last_authenticated_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
   WHERE c.user_id = p_user_id;
END;
$function$;

DO $rpc_privileges$
DECLARE
  function_signature text;
  role_name text;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.prodx_supervisor_find_credential(uuid, uuid, text)',
    'public.prodx_supervisor_record_failed_attempt(uuid, uuid, uuid)',
    'public.prodx_supervisor_reset_failed_attempts(uuid, uuid, uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', function_signature);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', function_signature, role_name);
      END IF;
    END LOOP;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO prodx_app', function_signature);
  END LOOP;
END
$rpc_privileges$;

COMMENT ON FUNCTION public.prodx_supervisor_find_credential(uuid, uuid, text) IS
  'Tenant-bound supervisor credential lookup for prodx_app; requires matching app.organization_id/app.store_id and app.user_id.';
COMMENT ON FUNCTION public.prodx_supervisor_record_failed_attempt(uuid, uuid, uuid) IS
  'Tenant-bound atomic supervisor failed-attempt increment and lockout for prodx_app.';
COMMENT ON FUNCTION public.prodx_supervisor_reset_failed_attempts(uuid, uuid, uuid, text) IS
  'Tenant-bound supervisor lockout reset for prodx_app; only for active supervisors holding the store-scoped refund/void permission.';

INSERT INTO public.prodx_schema_migrations(version)
VALUES ('0047_supervisor_authorization_credential_rpcs')
ON CONFLICT (version) DO NOTHING;
