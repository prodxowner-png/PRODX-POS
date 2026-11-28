-- Harden supervisor credential RPCs with requester and target store membership.
-- Existing migrations are immutable; this forward-only migration replaces the
-- SECURITY DEFINER functions without widening runtime table privileges.

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
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
#variable_conflict use_column
DECLARE
  v_identifier text := pg_catalog.btrim(COALESCE(p_identifier, ''));
  v_requester_id uuid := NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF p_organization_id IS NULL
     OR p_store_id IS NULL
     OR p_organization_id IS DISTINCT FROM NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::uuid
     OR p_store_id IS DISTINCT FROM NULLIF(pg_catalog.current_setting('app.store_id', true), '')::uuid
     OR v_requester_id IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM public.prodx_users requester
         JOIN public.prodx_store_memberships requester_membership
           ON requester_membership.organization_id = requester.organization_id
          AND requester_membership.user_id = requester.id
          AND requester_membership.store_id = p_store_id
          AND requester_membership.active = TRUE
        WHERE requester.id = v_requester_id
          AND requester.organization_id = p_organization_id
          AND requester.status = 'active'
     ) THEN
    RAISE EXCEPTION 'supervisor credential lookup is outside the authenticated tenant context'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize lookup with membership revocation. FOR SHARE conflicts with
  -- UPDATE/DELETE of the membership row and is held until the caller commits.
  PERFORM 1
    FROM public.prodx_users requester
    JOIN public.prodx_store_memberships requester_membership
      ON requester_membership.organization_id = requester.organization_id
     AND requester_membership.user_id = requester.id
     AND requester_membership.store_id = p_store_id
     AND requester_membership.active = TRUE
   WHERE requester.id = v_requester_id
     AND requester.organization_id = p_organization_id
     AND requester.status = 'active'
   FOR SHARE OF requester, requester_membership;
  IF NOT FOUND THEN
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
    JOIN public.prodx_store_memberships target_membership
      ON target_membership.organization_id = u.organization_id
     AND target_membership.user_id = u.id
     AND target_membership.store_id = p_store_id
     AND target_membership.active = TRUE
   WHERE u.organization_id = p_organization_id
     AND u.status = 'active'
     AND EXISTS (
       SELECT 1
         FROM public.prodx_users requester
         JOIN public.prodx_store_memberships requester_membership
           ON requester_membership.organization_id = requester.organization_id
          AND requester_membership.user_id = requester.id
          AND requester_membership.store_id = p_store_id
          AND requester_membership.active = TRUE
        WHERE requester.id = v_requester_id
          AND requester.organization_id = p_organization_id
          AND requester.status = 'active'
     )
     AND (u.id::text = v_identifier OR pg_catalog.lower(u.username) = pg_catalog.lower(v_identifier))
   ORDER BY (u.id::text = v_identifier) DESC
   LIMIT 1
   FOR SHARE OF u, target_membership;
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
DECLARE
  v_requester_id uuid := NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF p_organization_id IS NULL
     OR p_store_id IS NULL
     OR p_user_id IS NULL
     OR p_organization_id IS DISTINCT FROM NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::uuid
     OR p_store_id IS DISTINCT FROM NULLIF(pg_catalog.current_setting('app.store_id', true), '')::uuid
     OR v_requester_id IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM public.prodx_users requester
         JOIN public.prodx_store_memberships requester_membership
           ON requester_membership.organization_id = requester.organization_id
          AND requester_membership.user_id = requester.id
          AND requester_membership.store_id = p_store_id
          AND requester_membership.active = TRUE
        WHERE requester.id = v_requester_id
          AND requester.organization_id = p_organization_id
          AND requester.status = 'active'
     ) THEN
    RAISE EXCEPTION 'supervisor failed-attempt update is outside the authenticated tenant context'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
    FROM public.prodx_users requester
    JOIN public.prodx_store_memberships requester_membership
      ON requester_membership.organization_id = requester.organization_id
     AND requester_membership.user_id = requester.id
     AND requester_membership.store_id = p_store_id
     AND requester_membership.active = TRUE
   WHERE requester.id = v_requester_id
     AND requester.organization_id = p_organization_id
     AND requester.status = 'active'
   FOR SHARE OF requester, requester_membership;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'supervisor failed-attempt update is outside the authenticated tenant context'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
    FROM public.prodx_users u
    JOIN public.prodx_store_memberships target_membership
      ON target_membership.organization_id = u.organization_id
     AND target_membership.user_id = u.id
     AND target_membership.store_id = p_store_id
     AND target_membership.active = TRUE
   WHERE u.id = p_user_id
     AND u.organization_id = p_organization_id
     AND u.status = 'active'
   FOR SHARE OF u, target_membership;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- An identity without active membership in this store is deliberately a
  -- no-op: the caller cannot use this RPC to lock out users in another store.
  UPDATE public.prodx_user_credentials c
     SET failed_attempts = LEAST(c.failed_attempts + 1, 5),
         locked_until = CASE
           WHEN c.failed_attempts + 1 >= 5 THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes'
           ELSE c.locked_until
         END,
         updated_at = CURRENT_TIMESTAMP
    FROM public.prodx_users u
    JOIN public.prodx_store_memberships target_membership
      ON target_membership.organization_id = u.organization_id
     AND target_membership.user_id = u.id
     AND target_membership.store_id = p_store_id
     AND target_membership.active = TRUE
   WHERE c.user_id = p_user_id
     AND u.id = c.user_id
     AND u.organization_id = p_organization_id
     AND u.status = 'active'
     AND EXISTS (
       SELECT 1
         FROM public.prodx_users requester
         JOIN public.prodx_store_memberships requester_membership
           ON requester_membership.organization_id = requester.organization_id
          AND requester_membership.user_id = requester.id
          AND requester_membership.store_id = p_store_id
          AND requester_membership.active = TRUE
        WHERE requester.id = v_requester_id
          AND requester.organization_id = p_organization_id
          AND requester.status = 'active'
     )
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
  v_requester_id uuid := NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF p_organization_id IS NULL
     OR p_store_id IS NULL
     OR p_user_id IS NULL
     OR p_organization_id IS DISTINCT FROM NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::uuid
     OR p_store_id IS DISTINCT FROM NULLIF(pg_catalog.current_setting('app.store_id', true), '')::uuid
     OR v_requester_id IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM public.prodx_users requester
         JOIN public.prodx_store_memberships requester_membership
           ON requester_membership.organization_id = requester.organization_id
          AND requester_membership.user_id = requester.id
          AND requester_membership.store_id = p_store_id
          AND requester_membership.active = TRUE
        WHERE requester.id = v_requester_id
          AND requester.organization_id = p_organization_id
          AND requester.status = 'active'
     ) THEN
    RAISE EXCEPTION 'supervisor failed-attempt reset is outside the authenticated tenant context'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
    FROM public.prodx_users requester
    JOIN public.prodx_store_memberships requester_membership
      ON requester_membership.organization_id = requester.organization_id
     AND requester_membership.user_id = requester.id
     AND requester_membership.store_id = p_store_id
     AND requester_membership.active = TRUE
   WHERE requester.id = v_requester_id
     AND requester.organization_id = p_organization_id
     AND requester.status = 'active'
   FOR SHARE OF requester, requester_membership;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'supervisor failed-attempt reset is outside the authenticated tenant context'
      USING ERRCODE = '42501';
  END IF;

  v_permission_key := CASE p_action WHEN 'refund' THEN 'pos.refund' WHEN 'void' THEN 'pos.void' END;
  IF v_permission_key IS NULL THEN
    RAISE EXCEPTION 'supervisor action is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
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
   FOR SHARE OF u, m, ur, r, rp, p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'supervisor is not eligible for the requested store permission'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.prodx_user_credentials c
     SET failed_attempts = 0,
         locked_until = NULL,
         last_authenticated_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
    FROM public.prodx_users u
   WHERE c.user_id = p_user_id
     AND u.id = c.user_id
     AND u.organization_id = p_organization_id
     AND u.status = 'active'
     AND EXISTS (
       SELECT 1
         FROM public.prodx_users requester
         JOIN public.prodx_store_memberships requester_membership
           ON requester_membership.organization_id = requester.organization_id
          AND requester_membership.user_id = requester.id
          AND requester_membership.store_id = p_store_id
          AND requester_membership.active = TRUE
        WHERE requester.id = v_requester_id
          AND requester.organization_id = p_organization_id
          AND requester.status = 'active'
     )
     AND EXISTS (
       SELECT 1
         FROM public.prodx_store_memberships m
         JOIN public.prodx_user_roles ur
           ON ur.organization_id = m.organization_id AND ur.user_id = m.user_id
          AND ur.store_id = m.store_id AND ur.active = TRUE
         JOIN public.prodx_roles r
           ON r.id = ur.role_id AND r.organization_id = ur.organization_id AND r.active = TRUE
         JOIN public.prodx_role_permissions rp
           ON rp.organization_id = r.organization_id AND rp.role_id = r.id
         JOIN public.prodx_permissions p
           ON p.id = rp.permission_id AND p.permission_key = v_permission_key
        WHERE m.organization_id = p_organization_id
          AND m.store_id = p_store_id
          AND m.user_id = p_user_id
          AND m.active = TRUE
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'supervisor authorization eligibility changed before credential reset'
      USING ERRCODE = '42501';
  END IF;
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
  'Tenant- and store-bound supervisor credential lookup for prodx_app; requester and target must be active members of the requested store.';
COMMENT ON FUNCTION public.prodx_supervisor_record_failed_attempt(uuid, uuid, uuid) IS
  'Tenant- and store-bound atomic supervisor failed-attempt increment; requester and target must be active members of the requested store.';
COMMENT ON FUNCTION public.prodx_supervisor_reset_failed_attempts(uuid, uuid, uuid, text) IS
  'Tenant- and store-bound supervisor lockout reset; requester must be an active store member and target must hold the requested store permission.';

INSERT INTO public.prodx_schema_migrations(version)
VALUES ('0048_supervisor_credential_store_membership')
ON CONFLICT (version) DO NOTHING;
