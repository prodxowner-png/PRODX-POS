-- 0045: one-time, operator-authorized first-tenant bootstrap.
-- The backend verifies the Supabase JWT and a separate bootstrap secret before
-- calling this SECURITY DEFINER function. The function independently serializes
-- first-tenant creation and rejects every tenant except an exact idempotent retry.

DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prodx_app') THEN
    RAISE EXCEPTION 'Required runtime role prodx_app is missing';
  END IF;
  IF to_regclass('public.prodx_permissions') IS NULL
     OR to_regclass('public.prodx_security_audit_events') IS NULL THEN
    RAISE EXCEPTION 'Canonical permissions and security audit tables are required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.prodx_permissions) THEN
    RAISE EXCEPTION 'Canonical permission catalog is empty';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.prodx_auth_bootstrap_first_tenant(
  p_supabase_user_id uuid,
  p_organization_code text,
  p_organization_name text,
  p_store_code text,
  p_store_name text,
  p_business_timezone text,
  p_owner_username text,
  p_owner_display_name text,
  p_device_key text,
  p_device_name text
)
RETURNS TABLE(
  organization_id uuid,
  store_id uuid,
  user_id uuid,
  role_id uuid,
  device_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_organization_count bigint;
  v_permission_count bigint;
  v_assigned_permission_count bigint;
  v_organization_id uuid;
  v_store_id uuid;
  v_user_id uuid;
  v_role_id uuid;
  v_device_id uuid;
BEGIN
  IF p_supabase_user_id IS NULL
     OR p_organization_code IS NULL OR length(btrim(p_organization_code)) = 0 OR length(btrim(p_organization_code)) > 256
     OR p_organization_name IS NULL OR length(btrim(p_organization_name)) = 0 OR length(btrim(p_organization_name)) > 256
     OR p_store_code IS NULL OR length(btrim(p_store_code)) = 0 OR length(btrim(p_store_code)) > 256
     OR p_store_name IS NULL OR length(btrim(p_store_name)) = 0 OR length(btrim(p_store_name)) > 256
     OR p_business_timezone IS NULL OR length(btrim(p_business_timezone)) = 0 OR length(btrim(p_business_timezone)) > 256
     OR p_owner_username IS NULL OR length(btrim(p_owner_username)) = 0 OR length(btrim(p_owner_username)) > 256
     OR p_owner_display_name IS NULL OR length(btrim(p_owner_display_name)) = 0 OR length(btrim(p_owner_display_name)) > 256
     OR p_device_key IS NULL OR length(btrim(p_device_key)) = 0 OR length(btrim(p_device_key)) > 256
     OR p_device_name IS NULL OR length(btrim(p_device_name)) = 0 OR length(btrim(p_device_name)) > 256 THEN
    RAISE EXCEPTION 'First-tenant bootstrap configuration is incomplete'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names z
     WHERE z.name = p_business_timezone
  ) THEN
    RAISE EXCEPTION 'First-tenant business timezone is invalid'
      USING ERRCODE = '22023';
  END IF;

  -- A single transaction-scoped lock protects the global first-tenant invariant,
  -- including simultaneous requests for different verified Auth subjects.
  PERFORM pg_catalog.pg_advisory_xact_lock(731904221, 45);

  SELECT count(*) INTO v_organization_count FROM public.prodx_organizations;
  IF v_organization_count > 0 THEN
    -- Only a complete retry for the exact original subject and configuration is
    -- idempotent. Do not repair partial/manual state or provision another tenant.
    SELECT o.id, s.id, u.id, r.id, d.id
      INTO v_organization_id, v_store_id, v_user_id, v_role_id, v_device_id
      FROM public.prodx_organizations o
      JOIN public.prodx_stores s
        ON s.organization_id = o.id
       AND s.code = btrim(p_store_code)
       AND s.name = btrim(p_store_name)
       AND s.business_timezone = p_business_timezone
       AND s.active = TRUE
      JOIN public.prodx_users u
        ON u.organization_id = o.id
       AND u.supabase_auth_user_id = p_supabase_user_id
       AND u.username = btrim(p_owner_username)
       AND u.display_name = btrim(p_owner_display_name)
       AND u.status = 'active'
      JOIN public.prodx_roles r
        ON r.organization_id = o.id
       AND r.role_key = 'owner'
       AND r.name = 'Owner'
       AND r.active = TRUE
      JOIN public.prodx_store_memberships m
        ON m.organization_id = o.id
       AND m.store_id = s.id
       AND m.user_id = u.id
       AND m.active = TRUE
      JOIN public.prodx_user_roles ur
        ON ur.organization_id = o.id
       AND ur.store_id = s.id
       AND ur.user_id = u.id
       AND ur.role_id = r.id
       AND ur.active = TRUE
      JOIN public.prodx_devices d
        ON d.organization_id = o.id
       AND d.store_id = s.id
       AND d.device_key = btrim(p_device_key)
       AND d.name = btrim(p_device_name)
       AND d.status = 'active'
     WHERE o.code = btrim(p_organization_code)
       AND o.name = btrim(p_organization_name)
       AND v_organization_count = 1
     LIMIT 1;

    IF v_organization_id IS NULL THEN
      RAISE EXCEPTION 'First-tenant bootstrap has already been consumed'
        USING ERRCODE = '55000';
    END IF;

    SELECT count(*) INTO v_permission_count FROM public.prodx_permissions;
    SELECT count(*) INTO v_assigned_permission_count
      FROM public.prodx_role_permissions rp
      JOIN public.prodx_permissions p ON p.id = rp.permission_id
     WHERE rp.organization_id = v_organization_id
       AND rp.role_id = v_role_id;

    IF v_permission_count = 0
       OR v_assigned_permission_count <> v_permission_count
       OR NOT EXISTS (
         SELECT 1 FROM public.prodx_security_audit_events a
          WHERE a.organization_id = v_organization_id
            AND a.user_id = v_user_id
            AND a.event_type = 'first_tenant_bootstrapped'
            AND a.metadata ->> 'supabase_user_id' = p_supabase_user_id::text
            AND a.metadata ->> 'device_id' = v_device_id::text
       ) THEN
      RAISE EXCEPTION 'Existing first-tenant bootstrap state is incomplete or inconsistent'
        USING ERRCODE = '55000';
    END IF;

    RETURN QUERY SELECT v_organization_id, v_store_id, v_user_id, v_role_id, v_device_id;
    RETURN;
  END IF;

  SELECT count(*) INTO v_permission_count FROM public.prodx_permissions;
  IF v_permission_count = 0 THEN
    RAISE EXCEPTION 'Canonical permission catalog is empty'
      USING ERRCODE = '55000';
  END IF;

  v_organization_id := gen_random_uuid();
  v_store_id := gen_random_uuid();
  v_user_id := gen_random_uuid();
  v_role_id := gen_random_uuid();
  v_device_id := gen_random_uuid();

  INSERT INTO public.prodx_organizations (id, code, name)
  VALUES (v_organization_id, btrim(p_organization_code), btrim(p_organization_name));

  INSERT INTO public.prodx_stores (id, organization_id, code, name, business_timezone, active)
  VALUES (v_store_id, v_organization_id, btrim(p_store_code), btrim(p_store_name), p_business_timezone, TRUE);

  INSERT INTO public.prodx_users
    (id, organization_id, username, display_name, status, supabase_auth_user_id)
  VALUES
    (v_user_id, v_organization_id, btrim(p_owner_username), btrim(p_owner_display_name), 'active', p_supabase_user_id);

  INSERT INTO public.prodx_roles (id, organization_id, role_key, name, active)
  VALUES (v_role_id, v_organization_id, 'owner', 'Owner', TRUE);

  INSERT INTO public.prodx_store_memberships (organization_id, store_id, user_id, active)
  VALUES (v_organization_id, v_store_id, v_user_id, TRUE);

  INSERT INTO public.prodx_user_roles (organization_id, user_id, role_id, store_id, active)
  VALUES (v_organization_id, v_user_id, v_role_id, v_store_id, TRUE);

  -- Grant the complete canonical catalog to this tenant's Owner role only.
  -- Permission definitions remain global reference data and are never duplicated.
  INSERT INTO public.prodx_role_permissions (organization_id, role_id, permission_id)
  SELECT v_organization_id, v_role_id, p.id
    FROM public.prodx_permissions p;

  INSERT INTO public.prodx_devices
    (id, organization_id, store_id, device_key, name, status)
  VALUES
    (v_device_id, v_organization_id, v_store_id, btrim(p_device_key), btrim(p_device_name), 'active');

  -- The audit event commits atomically with the tenant, identity, RBAC, and device.
  INSERT INTO public.prodx_security_audit_events
    (id, organization_id, user_id, event_type, metadata)
  VALUES (
    gen_random_uuid(),
    v_organization_id,
    v_user_id,
    'first_tenant_bootstrapped',
    jsonb_build_object(
      'supabase_user_id', p_supabase_user_id,
      'store_id', v_store_id,
      'role_id', v_role_id,
      'device_id', v_device_id,
      'canonical_permission_count', v_permission_count
    )
  );

  RETURN QUERY SELECT v_organization_id, v_store_id, v_user_id, v_role_id, v_device_id;
END;
$function$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.prodx_auth_bootstrap_first_tenant(uuid, text, text, text, text, text, text, text, text, text)
  FROM PUBLIC;

DO $security$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON FUNCTION public.prodx_auth_bootstrap_first_tenant(uuid, text, text, text, text, text, text, text, text, text) FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$security$;

GRANT EXECUTE
  ON FUNCTION public.prodx_auth_bootstrap_first_tenant(uuid, text, text, text, text, text, text, text, text, text)
  TO prodx_app;

INSERT INTO public.prodx_schema_migrations(version)
VALUES ('0045_m9_secure_first_tenant_bootstrap')
ON CONFLICT (version) DO NOTHING;
