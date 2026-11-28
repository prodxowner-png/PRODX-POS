-- 0062: close the remaining authorization and audit-integrity gaps introduced by 0058.
-- This is additive: existing ledger rows and authorization grants are not rewritten.

CREATE OR REPLACE FUNCTION public.prodx_seed_discount_policy_for_store()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  INSERT INTO public.prodx_discount_policies (organization_id, store_id)
  VALUES (NEW.organization_id, NEW.id)
  ON CONFLICT (organization_id, store_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- Password-based discount approval must use the same store permission as the
-- application authorization check. Migration 0048 only recognized refund/void.
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

  v_permission_key := CASE p_action
    WHEN 'refund' THEN 'pos.refund'
    WHEN 'void' THEN 'pos.void'
    WHEN 'discount' THEN 'pos.discount.approve'
  END;
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

-- A caller must be an active member of the requested store before either
-- supervisor lookup RPC can return identity or credential material.
CREATE OR REPLACE FUNCTION public.prodx_auth_find_supervisor_by_supabase_subject(
  p_organization_id uuid,
  p_store_id uuid,
  p_supabase_subject uuid
)
RETURNS TABLE (user_id uuid, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_context_org uuid := NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::uuid;
  v_context_store uuid := NULLIF(pg_catalog.current_setting('app.store_id', true), '')::uuid;
  v_context_user uuid := NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF p_organization_id IS NULL
     OR p_store_id IS NULL
     OR p_supabase_subject IS NULL
     OR p_organization_id IS DISTINCT FROM v_context_org
     OR p_store_id IS DISTINCT FROM v_context_store
     OR v_context_user IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM public.prodx_users requester
         JOIN public.prodx_store_memberships membership
           ON membership.organization_id = requester.organization_id
          AND membership.user_id = requester.id
          AND membership.store_id = v_context_store
          AND membership.active = TRUE
        WHERE requester.id = v_context_user
          AND requester.organization_id = v_context_org
          AND requester.status = 'active'
     ) THEN
    RAISE EXCEPTION 'supervisor identity lookup is outside the authenticated tenant context'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT u.id, u.status
    FROM public.prodx_users u
    JOIN public.prodx_store_memberships m
      ON m.organization_id = u.organization_id
     AND m.user_id = u.id
   WHERE u.organization_id = p_organization_id
     AND u.supabase_auth_user_id = p_supabase_subject
     AND u.status = 'active'
     AND m.store_id = p_store_id
     AND m.active = TRUE
   LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prodx_auth_find_supervisor_credential(
  p_organization_id uuid,
  p_store_id uuid,
  p_lookup text
)
RETURNS TABLE (
  "userId" uuid,
  "organizationId" uuid,
  status text,
  "secretHash" text,
  "failedAttempts" integer,
  "lockedUntil" timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_context_org uuid := NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::uuid;
  v_context_store uuid := NULLIF(pg_catalog.current_setting('app.store_id', true), '')::uuid;
  v_context_user uuid := NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF p_organization_id IS NULL
     OR p_store_id IS NULL
     OR p_lookup IS NULL
     OR length(btrim(p_lookup)) = 0
     OR length(p_lookup) > 320
     OR p_organization_id IS DISTINCT FROM v_context_org
     OR p_store_id IS DISTINCT FROM v_context_store
     OR v_context_user IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM public.prodx_users requester
         JOIN public.prodx_store_memberships membership
           ON membership.organization_id = requester.organization_id
          AND membership.user_id = requester.id
          AND membership.store_id = v_context_store
          AND membership.active = TRUE
        WHERE requester.id = v_context_user
          AND requester.organization_id = v_context_org
          AND requester.status = 'active'
     ) THEN
    RAISE EXCEPTION 'supervisor credential lookup is outside the authenticated tenant context'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT u.id, u.organization_id, u.status, c.secret_hash, c.failed_attempts, c.locked_until
    FROM public.prodx_users u
    JOIN public.prodx_user_credentials c ON c.user_id = u.id
    JOIN public.prodx_store_memberships m
      ON m.organization_id = u.organization_id AND m.user_id = u.id
   WHERE u.organization_id = p_organization_id
     AND c.credential_type = 'password'
     AND m.store_id = p_store_id
     AND m.active = TRUE
     AND (u.id::text = p_lookup OR pg_catalog.lower(u.username) = pg_catalog.lower(p_lookup))
   LIMIT 1;
END;
$function$;

-- Security audit writes are restricted to the authenticated store context,
-- known event contracts, real store members, and persisted discount state.
CREATE OR REPLACE FUNCTION public.prodx_record_security_audit_event(
  p_id uuid,
  p_organization_id uuid,
  p_user_id uuid,
  p_event_type text,
  p_metadata jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_context_org uuid := NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::uuid;
  v_context_store uuid := NULLIF(pg_catalog.current_setting('app.store_id', true), '')::uuid;
  v_context_user uuid := NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid;
  v_action text;
  v_requester uuid;
  v_reason text;
  v_allowed_keys text[];
  v_actor_must_be_requester boolean := false;
  v_permission_key text;
  v_order_id uuid;
  v_idempotency_key text;
  v_checkout_hash text;
  v_threshold integer;
BEGIN
  IF p_id IS NULL
     OR p_organization_id IS NULL
     OR p_organization_id IS DISTINCT FROM v_context_org
     OR v_context_store IS NULL
     OR v_context_user IS NULL THEN
    RAISE EXCEPTION 'security audit event is outside the authenticated tenant/store context'
      USING ERRCODE = '42501';
  END IF;

  IF p_event_type IS NULL OR p_event_type NOT IN (
       'SUPERVISOR_AUTH_FAILED',
       'SUPERVISOR_AUTH_DENIED',
       'SUPERVISOR_AUTH_REJECTED',
       'SUPERVISOR_AUTHORIZATION_REQUESTED',
       'SUPERVISOR_AUTHORIZATION_GRANTED',
       'SUPERVISOR_AUTHORIZATION_CONSUMED',
       'SUPERVISOR_AUTHORIZATION_REPLAYED',
       'SUPERVISOR_AUTHORIZATION_REJECTED',
       'DISCOUNT_POLICY_UPDATED'
     )
     OR p_metadata IS NULL
     OR pg_catalog.jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION 'security audit event type or payload is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.prodx_users requester
    JOIN public.prodx_store_memberships membership
      ON membership.organization_id = requester.organization_id
     AND membership.user_id = requester.id
     AND membership.store_id = v_context_store
     AND membership.active = TRUE
   WHERE requester.id = v_context_user
     AND requester.organization_id = v_context_org
     AND requester.status = 'active'
   FOR SHARE OF requester, membership;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'security audit requester is not an active member of the authenticated store'
      USING ERRCODE = '42501';
  END IF;

  v_action := p_metadata->>'action';
  v_reason := p_metadata->>'reason';

  CASE p_event_type
    WHEN 'SUPERVISOR_AUTH_FAILED' THEN
      IF p_metadata ? 'requesterUserId' THEN
        v_allowed_keys := ARRAY['action', 'orderId', 'requesterUserId'];
        v_requester := (p_metadata->>'requesterUserId')::uuid;
      ELSE
        v_allowed_keys := ARRAY['action', 'requestedSupervisorUserId', 'reason'];
        v_actor_must_be_requester := TRUE;
        IF v_reason IS DISTINCT FROM 'supabase_reauthentication_failed' THEN
          RAISE EXCEPTION 'supervisor failure reason is invalid' USING ERRCODE = '22023';
        END IF;
      END IF;
      IF v_action IS NULL OR v_action NOT IN ('refund', 'void', 'discount') THEN
        RAISE EXCEPTION 'supervisor action is invalid' USING ERRCODE = '22023';
      END IF;

    WHEN 'SUPERVISOR_AUTH_DENIED' THEN
      IF p_metadata ? 'requesterUserId' THEN
        v_allowed_keys := ARRAY['action', 'orderId', 'requesterUserId', 'reason'];
        v_requester := (p_metadata->>'requesterUserId')::uuid;
        IF v_reason IS DISTINCT FROM 'store_permission_missing' THEN
          RAISE EXCEPTION 'supervisor denial reason is invalid' USING ERRCODE = '22023';
        END IF;
      ELSE
        v_allowed_keys := ARRAY['action', 'requestedSupervisorUserId', 'reason'];
        v_actor_must_be_requester := TRUE;
        IF v_reason IS DISTINCT FROM 'supabase_subject_not_authorized' THEN
          RAISE EXCEPTION 'supervisor identity denial reason is invalid' USING ERRCODE = '22023';
        END IF;
      END IF;
      IF v_action IS NULL OR v_action NOT IN ('refund', 'void', 'discount') THEN
        RAISE EXCEPTION 'supervisor action is invalid' USING ERRCODE = '22023';
      END IF;

    WHEN 'SUPERVISOR_AUTH_REJECTED' THEN
      v_allowed_keys := ARRAY['action', 'storeId', 'orderId', 'requesterUserId', 'requestedSupervisorUserId', 'reason'];
      IF NOT (p_metadata ? 'requesterUserId')
         OR pg_catalog.jsonb_typeof(p_metadata->'requesterUserId') IS DISTINCT FROM 'string'
         OR pg_catalog.length(pg_catalog.btrim(p_metadata->>'requesterUserId')) = 0 THEN
        RAISE EXCEPTION 'security audit requester is required for supervisor rejection'
          USING ERRCODE = '22023';
      END IF;
      IF NOT (p_metadata ? 'storeId')
         OR pg_catalog.jsonb_typeof(p_metadata->'storeId') IS DISTINCT FROM 'string'
         OR (p_metadata->>'storeId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'security audit store is required for supervisor rejection'
          USING ERRCODE = '22023';
      END IF;
      IF (p_metadata->>'storeId')::uuid IS DISTINCT FROM v_context_store THEN
        RAISE EXCEPTION 'security audit store does not match authenticated store'
          USING ERRCODE = '42501';
      END IF;
      v_requester := (p_metadata->>'requesterUserId')::uuid;
      IF v_action IS DISTINCT FROM 'discount'
         OR v_reason IS DISTINCT FROM 'invalid_or_locked' THEN
        RAISE EXCEPTION 'supervisor rejection payload is invalid' USING ERRCODE = '22023';
      END IF;

    WHEN 'SUPERVISOR_AUTHORIZATION_REQUESTED' THEN
      v_allowed_keys := ARRAY['action', 'storeId', 'idempotencyKey', 'payloadHash', 'thresholdBps'];
      v_actor_must_be_requester := TRUE;
      IF NOT (p_metadata ? 'storeId')
         OR pg_catalog.jsonb_typeof(p_metadata->'storeId') IS DISTINCT FROM 'string'
         OR (p_metadata->>'storeId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'security audit store is required for discount authorization request'
          USING ERRCODE = '22023';
      END IF;
      IF (p_metadata->>'storeId')::uuid IS DISTINCT FROM v_context_store THEN
        RAISE EXCEPTION 'security audit store does not match authenticated store'
          USING ERRCODE = '42501';
      END IF;
      v_idempotency_key := p_metadata->>'idempotencyKey';
      v_checkout_hash := p_metadata->>'payloadHash';
      IF v_action IS DISTINCT FROM 'discount'
         OR v_idempotency_key IS NULL
         OR length(v_idempotency_key) = 0
         OR length(v_idempotency_key) > 256
         OR v_checkout_hash IS NULL OR v_checkout_hash !~ '^[0-9a-f]{64}$'
         OR pg_catalog.jsonb_typeof(p_metadata->'thresholdBps') IS DISTINCT FROM 'number'
         OR (p_metadata->>'thresholdBps')::numeric <> pg_catalog.trunc((p_metadata->>'thresholdBps')::numeric)
         OR (p_metadata->>'thresholdBps')::integer NOT BETWEEN 0 AND 10000 THEN
        RAISE EXCEPTION 'discount authorization request payload is invalid' USING ERRCODE = '22023';
      END IF;
      v_threshold := (p_metadata->>'thresholdBps')::integer;
      v_permission_key := 'pos.discount';
      IF NOT EXISTS (
        SELECT 1 FROM public.prodx_discount_policies policy
         WHERE policy.organization_id = v_context_org
           AND policy.store_id = v_context_store
           AND policy.require_supervisor_approval IS TRUE
           AND policy.max_discount_without_approval_bps = v_threshold
      ) THEN
        RAISE EXCEPTION 'discount authorization request does not match the current store policy'
          USING ERRCODE = '42501';
      END IF;

    WHEN 'SUPERVISOR_AUTHORIZATION_GRANTED' THEN
      v_allowed_keys := ARRAY[
        'action', 'requesterUserId', 'requesterSessionId', 'expiresAt',
        'checkoutIdempotencyKey', 'checkoutPayloadHash', 'policyThresholdBps', 'policyRequiresApproval'
      ];
      v_requester := (p_metadata->>'requesterUserId')::uuid;
      v_idempotency_key := p_metadata->>'checkoutIdempotencyKey';
      v_checkout_hash := p_metadata->>'checkoutPayloadHash';
      IF v_action IS DISTINCT FROM 'discount'
         OR v_idempotency_key IS NULL
         OR length(v_idempotency_key) = 0
         OR length(v_idempotency_key) > 256
         OR v_checkout_hash IS NULL OR v_checkout_hash !~ '^[0-9a-f]{64}$'
         OR (p_metadata->>'requesterSessionId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR pg_catalog.jsonb_typeof(p_metadata->'policyThresholdBps') IS DISTINCT FROM 'number'
         OR (p_metadata->>'policyThresholdBps')::numeric <> pg_catalog.trunc((p_metadata->>'policyThresholdBps')::numeric)
         OR (p_metadata->>'policyThresholdBps')::integer NOT BETWEEN 0 AND 10000
         OR p_metadata->'policyRequiresApproval' IS DISTINCT FROM 'true'::jsonb
         OR (p_metadata->>'expiresAt') IS NULL THEN
        RAISE EXCEPTION 'discount authorization grant payload is invalid' USING ERRCODE = '22023';
      END IF;
      v_threshold := (p_metadata->>'policyThresholdBps')::integer;
      PERFORM (p_metadata->>'expiresAt')::timestamptz;
      v_permission_key := 'pos.discount.approve';
      IF NOT EXISTS (
        SELECT 1
          FROM public.prodx_supervisor_authorizations authz
         WHERE authz.organization_id = v_context_org
           AND authz.store_id = v_context_store
           AND authz.requester_user_id = v_context_user
           AND authz.requester_session_id = (p_metadata->>'requesterSessionId')::uuid
           AND authz.supervisor_user_id = p_user_id
           AND authz.action_key = 'discount'
           AND authz.order_id IS NULL
           AND authz.checkout_idempotency_key = v_idempotency_key
           AND authz.checkout_payload_hash = v_checkout_hash
           AND authz.policy_threshold_bps = v_threshold
           AND authz.policy_requires_approval IS TRUE
           AND authz.expires_at = (p_metadata->>'expiresAt')::timestamptz
           AND authz.consumed_at IS NULL
      ) THEN
        RAISE EXCEPTION 'discount authorization grant has no matching persisted authorization'
          USING ERRCODE = '42501';
      END IF;

    WHEN 'SUPERVISOR_AUTHORIZATION_CONSUMED' THEN
      v_allowed_keys := ARRAY[
        'action', 'orderId', 'idempotencyKey', 'requesterUserId',
        'checkoutPayloadHash', 'policyThresholdBps', 'policyRequiresApproval'
      ];
      v_requester := (p_metadata->>'requesterUserId')::uuid;
      v_action := p_metadata->>'action';
      IF v_action IS NULL OR v_action NOT IN ('refund', 'void', 'discount') THEN
        RAISE EXCEPTION 'supervisor consume action is invalid' USING ERRCODE = '22023';
      END IF;
      IF v_action = 'discount' THEN
        v_idempotency_key := p_metadata->>'idempotencyKey';
        v_checkout_hash := p_metadata->>'checkoutPayloadHash';
        IF p_metadata->'orderId' IS DISTINCT FROM 'null'::jsonb
           OR v_idempotency_key IS NULL
           OR length(v_idempotency_key) = 0
           OR length(v_idempotency_key) > 256
           OR v_checkout_hash IS NULL OR v_checkout_hash !~ '^[0-9a-f]{64}$'
           OR pg_catalog.jsonb_typeof(p_metadata->'policyThresholdBps') IS DISTINCT FROM 'number'
           OR (p_metadata->>'policyThresholdBps')::numeric <> pg_catalog.trunc((p_metadata->>'policyThresholdBps')::numeric)
           OR (p_metadata->>'policyThresholdBps')::integer NOT BETWEEN 0 AND 10000
           OR p_metadata->'policyRequiresApproval' IS DISTINCT FROM 'true'::jsonb THEN
          RAISE EXCEPTION 'discount authorization consume payload is invalid' USING ERRCODE = '22023';
        END IF;
        v_threshold := (p_metadata->>'policyThresholdBps')::integer;
      ELSE
        v_order_id := (p_metadata->>'orderId')::uuid;
        IF v_order_id IS NULL
           OR p_metadata->'idempotencyKey' IS DISTINCT FROM 'null'::jsonb
           OR p_metadata ? 'checkoutPayloadHash'
           OR p_metadata ? 'policyThresholdBps'
           OR p_metadata ? 'policyRequiresApproval' THEN
          RAISE EXCEPTION 'refund/void authorization consume payload is invalid' USING ERRCODE = '22023';
        END IF;
      END IF;
      v_permission_key := CASE v_action
        WHEN 'refund' THEN 'pos.refund'
        WHEN 'void' THEN 'pos.void'
        WHEN 'discount' THEN 'pos.discount.approve'
      END;
      IF NOT EXISTS (
        SELECT 1
          FROM public.prodx_supervisor_authorizations authz
         WHERE authz.organization_id = v_context_org
           AND authz.store_id = v_context_store
           AND authz.requester_user_id = v_context_user
           AND authz.supervisor_user_id = p_user_id
           AND authz.action_key = v_action
           AND authz.order_id IS NOT DISTINCT FROM v_order_id
           AND authz.checkout_idempotency_key IS NOT DISTINCT FROM v_idempotency_key
           AND authz.checkout_payload_hash IS NOT DISTINCT FROM v_checkout_hash
           AND authz.policy_threshold_bps IS NOT DISTINCT FROM v_threshold
           AND authz.policy_requires_approval IS NOT DISTINCT FROM
               CASE WHEN v_action = 'discount' THEN TRUE ELSE NULL::boolean END
           AND authz.consumed_at IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'consumed supervisor authorization has no matching persisted grant'
          USING ERRCODE = '42501';
      END IF;

    WHEN 'SUPERVISOR_AUTHORIZATION_REPLAYED' THEN
      v_allowed_keys := ARRAY[
        'action', 'orderId', 'idempotencyKey', 'requesterUserId',
        'checkoutPayloadHash', 'policyThresholdBps', 'policyRequiresApproval'
      ];
      v_requester := (p_metadata->>'requesterUserId')::uuid;
      v_actor_must_be_requester := TRUE;
      v_action := p_metadata->>'action';
      IF v_action IS NULL OR v_action NOT IN ('refund', 'void', 'discount') THEN
        RAISE EXCEPTION 'supervisor replay action is invalid' USING ERRCODE = '22023';
      END IF;
      IF v_action = 'discount' THEN
        v_idempotency_key := p_metadata->>'idempotencyKey';
        v_checkout_hash := p_metadata->>'checkoutPayloadHash';
        IF p_metadata->'orderId' IS DISTINCT FROM 'null'::jsonb
           OR v_idempotency_key IS NULL
           OR length(v_idempotency_key) = 0
           OR length(v_idempotency_key) > 256
           OR v_checkout_hash IS NULL OR v_checkout_hash !~ '^[0-9a-f]{64}$'
           OR pg_catalog.jsonb_typeof(p_metadata->'policyThresholdBps') IS DISTINCT FROM 'number'
           OR (p_metadata->>'policyThresholdBps')::numeric <> pg_catalog.trunc((p_metadata->>'policyThresholdBps')::numeric)
           OR (p_metadata->>'policyThresholdBps')::integer NOT BETWEEN 0 AND 10000
           OR p_metadata->'policyRequiresApproval' IS DISTINCT FROM 'true'::jsonb THEN
          RAISE EXCEPTION 'discount authorization replay payload is invalid' USING ERRCODE = '22023';
        END IF;
        v_threshold := (p_metadata->>'policyThresholdBps')::integer;
      ELSE
        v_order_id := (p_metadata->>'orderId')::uuid;
        IF v_order_id IS NULL
           OR p_metadata->'idempotencyKey' IS DISTINCT FROM 'null'::jsonb
           OR p_metadata ? 'checkoutPayloadHash'
           OR p_metadata ? 'policyThresholdBps'
           OR p_metadata ? 'policyRequiresApproval' THEN
          RAISE EXCEPTION 'refund/void authorization replay payload is invalid' USING ERRCODE = '22023';
        END IF;
      END IF;
      IF NOT EXISTS (
        SELECT 1
          FROM public.prodx_supervisor_authorizations authz
         WHERE authz.organization_id = v_context_org
           AND authz.store_id = v_context_store
           AND authz.requester_user_id = v_context_user
           AND authz.action_key = v_action
           AND authz.order_id IS NOT DISTINCT FROM v_order_id
           AND authz.checkout_idempotency_key IS NOT DISTINCT FROM v_idempotency_key
           AND authz.checkout_payload_hash IS NOT DISTINCT FROM v_checkout_hash
           AND authz.policy_threshold_bps IS NOT DISTINCT FROM v_threshold
           AND authz.policy_requires_approval IS NOT DISTINCT FROM
               CASE WHEN v_action = 'discount' THEN TRUE ELSE NULL::boolean END
           AND authz.consumed_at IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'replayed supervisor authorization has no consumed grant'
          USING ERRCODE = '42501';
      END IF;

    WHEN 'SUPERVISOR_AUTHORIZATION_REJECTED' THEN
      v_allowed_keys := ARRAY['action', 'idempotencyKey', 'reason'];
      v_actor_must_be_requester := TRUE;
      v_idempotency_key := p_metadata->>'idempotencyKey';
      IF p_metadata->>'action' IS DISTINCT FROM 'discount'
         OR v_idempotency_key IS NULL
         OR length(v_idempotency_key) = 0
         OR length(v_idempotency_key) > 256
         OR v_reason IS NULL OR v_reason NOT IN ('IDEMPOTENCY_PAYLOAD_MISMATCH', 'AUTHORIZATION_EXPIRED', 'AUTHORIZATION_REPLAYED') THEN
        RAISE EXCEPTION 'discount authorization rejection payload is invalid' USING ERRCODE = '22023';
      END IF;

    WHEN 'DISCOUNT_POLICY_UPDATED' THEN
      v_allowed_keys := ARRAY['storeId', 'requireSupervisorApproval', 'maxDiscountWithoutApprovalBps'];
      v_actor_must_be_requester := TRUE;
      v_permission_key := 'settings.manage';
      IF (p_metadata->>'storeId')::uuid IS DISTINCT FROM v_context_store
         OR pg_catalog.jsonb_typeof(p_metadata->'requireSupervisorApproval') IS DISTINCT FROM 'boolean'
         OR pg_catalog.jsonb_typeof(p_metadata->'maxDiscountWithoutApprovalBps') IS DISTINCT FROM 'number'
         OR (p_metadata->>'maxDiscountWithoutApprovalBps')::numeric <> pg_catalog.trunc((p_metadata->>'maxDiscountWithoutApprovalBps')::numeric)
         OR (p_metadata->>'maxDiscountWithoutApprovalBps')::integer NOT BETWEEN 0 AND 10000 THEN
        RAISE EXCEPTION 'discount policy audit payload is invalid' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.prodx_discount_policies policy
         WHERE policy.organization_id = v_context_org
           AND policy.store_id = v_context_store
           AND policy.updated_by_user_id = p_user_id
           AND policy.require_supervisor_approval = (p_metadata->>'requireSupervisorApproval')::boolean
           AND policy.max_discount_without_approval_bps = (p_metadata->>'maxDiscountWithoutApprovalBps')::integer
      ) THEN
        RAISE EXCEPTION 'discount policy audit event does not match persisted policy state'
          USING ERRCODE = '42501';
      END IF;
  END CASE;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_object_keys(p_metadata) AS item(key)
     WHERE NOT (item.key = ANY(v_allowed_keys))
  ) THEN
    RAISE EXCEPTION 'security audit event metadata contains unsupported fields'
      USING ERRCODE = '22023';
  END IF;

  IF p_metadata ? 'requesterUserId' AND v_requester IS NULL THEN
    RAISE EXCEPTION 'security audit requester is required' USING ERRCODE = '22023';
  END IF;

  IF p_metadata ? 'requestedSupervisorUserId'
     AND (pg_catalog.jsonb_typeof(p_metadata->'requestedSupervisorUserId') IS DISTINCT FROM 'string'
       OR length(p_metadata->>'requestedSupervisorUserId') = 0
       OR length(p_metadata->>'requestedSupervisorUserId') > 128) THEN
    RAISE EXCEPTION 'requested supervisor identity is invalid' USING ERRCODE = '22023';
  END IF;

  IF p_metadata ? 'orderId'
     AND p_metadata->'orderId' IS DISTINCT FROM 'null'::jsonb
     AND (pg_catalog.jsonb_typeof(p_metadata->'orderId') IS DISTINCT FROM 'string'
       OR (p_metadata->>'orderId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'security audit order identity is invalid' USING ERRCODE = '22023';
  END IF;

  IF v_requester IS NOT NULL AND v_requester IS DISTINCT FROM v_context_user THEN
    RAISE EXCEPTION 'security audit requester does not match authenticated user'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_must_be_requester AND p_user_id IS DISTINCT FROM v_context_user THEN
    RAISE EXCEPTION 'security audit actor does not match authenticated user'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL AND p_event_type <> 'SUPERVISOR_AUTH_REJECTED' THEN
    RAISE EXCEPTION 'security audit actor is required for this event type'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NOT NULL THEN
    PERFORM 1
      FROM public.prodx_users actor
      JOIN public.prodx_store_memberships membership
        ON membership.organization_id = actor.organization_id
       AND membership.user_id = actor.id
       AND membership.store_id = v_context_store
       AND membership.active = TRUE
     WHERE actor.id = p_user_id
       AND actor.organization_id = v_context_org
       AND actor.status = 'active'
     FOR SHARE OF actor, membership;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'security audit actor is not an active member of the authenticated store'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_permission_key IS NOT NULL THEN
    PERFORM 1
      FROM public.prodx_users actor
      JOIN public.prodx_store_memberships m
        ON m.organization_id = actor.organization_id
       AND m.user_id = actor.id
       AND m.store_id = v_context_store
       AND m.active = TRUE
      JOIN public.prodx_user_roles ur
        ON ur.organization_id = m.organization_id
       AND ur.user_id = m.user_id
       AND ur.store_id = m.store_id
       AND ur.active = TRUE
      JOIN public.prodx_roles r
        ON r.id = ur.role_id
       AND r.organization_id = ur.organization_id
       AND r.active = TRUE
      JOIN public.prodx_role_permissions rp
        ON rp.organization_id = r.organization_id
       AND rp.role_id = r.id
      JOIN public.prodx_permissions permission
        ON permission.id = rp.permission_id
       AND permission.permission_key = v_permission_key
     WHERE actor.id = p_user_id
       AND actor.organization_id = v_context_org
       AND actor.status = 'active'
     FOR SHARE OF actor, m, ur, r, rp, permission;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'security audit supervisor does not hold the required store permission'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.prodx_security_audit_events
    (id, organization_id, user_id, event_type, metadata)
  VALUES (p_id, p_organization_id, p_user_id, p_event_type, p_metadata);
END;
$function$;

-- Return the status of a credential-bearing member to the backend so disabled
-- targets can be rejected with an attributable target ID but a NULL audit actor.
-- The RPC remains backend-only; no Supabase API role receives EXECUTE.
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

DO $credential_lookup_privileges$
DECLARE
  role_name text;
BEGIN
  REVOKE ALL ON FUNCTION public.prodx_supervisor_find_credential(uuid, uuid, text) FROM PUBLIC;
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.prodx_supervisor_find_credential(uuid, uuid, text) FROM %I', role_name);
    END IF;
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.prodx_supervisor_find_credential(uuid, uuid, text) TO prodx_app;
END
$credential_lookup_privileges$;

COMMENT ON FUNCTION public.prodx_supervisor_find_credential(uuid, uuid, text) IS
  'Tenant/store-bound backend-only credential lookup; returns disabled member status for rejection auditing and never authorizes disabled users.';

-- Supabase grants execute on new public-schema functions to its API roles by
-- default. Remove those grants explicitly; only the backend runtime gets RPC access.
DO $rpc_privileges$
DECLARE
  function_signature text;
  role_name text;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.prodx_seed_discount_policy_for_store()',
    'public.prodx_auth_find_supervisor_by_supabase_subject(uuid, uuid, uuid)',
    'public.prodx_auth_find_supervisor_credential(uuid, uuid, text)',
    'public.prodx_record_security_audit_event(uuid, uuid, uuid, text, jsonb)',
    'public.prodx_supervisor_reset_failed_attempts(uuid, uuid, uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', function_signature);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'prodx_app'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', function_signature, role_name);
      END IF;
    END LOOP;
  END LOOP;
END
$rpc_privileges$;

GRANT EXECUTE ON FUNCTION public.prodx_auth_find_supervisor_by_supabase_subject(uuid, uuid, uuid) TO prodx_app;
-- The credential-returning auth lookup has no production call site; keep it unexecutable until it is wired and reviewed.
GRANT EXECUTE ON FUNCTION public.prodx_record_security_audit_event(uuid, uuid, uuid, text, jsonb) TO prodx_app;
GRANT EXECUTE ON FUNCTION public.prodx_supervisor_reset_failed_attempts(uuid, uuid, uuid, text) TO prodx_app;

COMMENT ON FUNCTION public.prodx_supervisor_reset_failed_attempts(uuid, uuid, uuid, text) IS
  'Tenant/store-bound supervisor lockout reset for refund, void, and discount approval permissions.';

COMMENT ON FUNCTION public.prodx_record_security_audit_event(uuid, uuid, uuid, text, jsonb) IS
  'Append-only security audit writer restricted to the authenticated store, approved event contracts, verified actors, and persisted authorization state.';

INSERT INTO public.prodx_schema_migrations(version)
VALUES ('0062_security_harden_discount_authorization_rpcs')
ON CONFLICT (version) DO NOTHING;
