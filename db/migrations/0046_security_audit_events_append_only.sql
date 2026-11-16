-- 0046: make security audit events immutable and retain historical identity references.
-- Audit rows must survive user/organization deletion without FK-driven UPDATEs.
-- Tenant isolation remains enforced by the existing organization_id RLS policy.

DO $constraints$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname
      FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.prodx_security_audit_events'::regclass
       AND contype = 'f'
       AND confrelid IN (
         'public.prodx_organizations'::regclass,
         'public.prodx_users'::regclass
       )
  LOOP
    EXECUTE format(
      'ALTER TABLE public.prodx_security_audit_events DROP CONSTRAINT %I',
      constraint_row.conname
    );
  END LOOP;
END
$constraints$;

COMMENT ON TABLE public.prodx_security_audit_events IS
  'Append-only security audit events. organization_id and user_id are immutable historical identifiers, intentionally not foreign keys so events survive entity deletion.';

-- The runtime role is deliberately SELECT-only on the ledger. Supervisor
-- authorization events therefore enter through this narrow, tenant-bound RPC.
CREATE OR REPLACE FUNCTION public.prodx_record_supervisor_authorization_event(
  p_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
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
  v_context_organization_id uuid;
  v_context_store_id uuid;
  v_context_user_id uuid;
  v_allowed_keys text[];
BEGIN
  v_context_organization_id := NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::uuid;
  v_context_store_id := NULLIF(pg_catalog.current_setting('app.store_id', true), '')::uuid;
  v_context_user_id := NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid;

  IF p_id IS NULL
     OR p_organization_id IS DISTINCT FROM v_context_organization_id
     OR p_store_id IS DISTINCT FROM v_context_store_id
     OR v_context_user_id IS NULL THEN
    RAISE EXCEPTION 'supervisor audit event is outside the authenticated tenant context'
      USING ERRCODE = '42501';
  END IF;

  IF p_event_type IS NULL OR p_event_type NOT IN (
    'SUPERVISOR_AUTH_REJECTED',
    'SUPERVISOR_AUTH_FAILED',
    'SUPERVISOR_AUTH_DENIED',
    'SUPERVISOR_AUTHORIZATION_GRANTED'
  ) OR p_metadata IS NULL OR pg_catalog.jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION 'supervisor audit event type or metadata is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_metadata->>'requesterUserId' IS DISTINCT FROM v_context_user_id::text
     OR p_metadata->>'action' IS NULL
     OR p_metadata->>'action' NOT IN ('refund', 'void')
     OR p_metadata->>'orderId' IS NULL
     OR p_metadata->>'orderId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'supervisor audit event metadata does not match the authenticated request'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.prodx_organizations o WHERE o.id = p_organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.prodx_stores s
     WHERE s.id = p_store_id AND s.organization_id = p_organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.prodx_users u
     WHERE u.id = v_context_user_id AND u.organization_id = p_organization_id
  ) OR (p_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.prodx_users u
     WHERE u.id = p_user_id AND u.organization_id = p_organization_id
  )) THEN
    RAISE EXCEPTION 'supervisor audit event identity is outside the organization'
      USING ERRCODE = '23503';
  END IF;

  IF p_user_id IS NULL AND p_event_type <> 'SUPERVISOR_AUTH_REJECTED' THEN
    RAISE EXCEPTION 'supervisor audit event actor is required'
      USING ERRCODE = '22023';
  END IF;

  CASE p_event_type
    WHEN 'SUPERVISOR_AUTH_REJECTED' THEN
      v_allowed_keys := ARRAY['action', 'orderId', 'requesterUserId', 'reason'];
      IF p_metadata->>'reason' IS DISTINCT FROM 'invalid_or_locked' THEN
        RAISE EXCEPTION 'supervisor rejection reason is invalid' USING ERRCODE = '22023';
      END IF;
    WHEN 'SUPERVISOR_AUTH_FAILED' THEN
      v_allowed_keys := ARRAY['action', 'orderId', 'requesterUserId'];
    WHEN 'SUPERVISOR_AUTH_DENIED' THEN
      v_allowed_keys := ARRAY['action', 'orderId', 'requesterUserId', 'reason'];
      IF p_metadata->>'reason' IS DISTINCT FROM 'store_permission_missing' THEN
        RAISE EXCEPTION 'supervisor denial reason is invalid' USING ERRCODE = '22023';
      END IF;
    WHEN 'SUPERVISOR_AUTHORIZATION_GRANTED' THEN
      v_allowed_keys := ARRAY['action', 'orderId', 'requesterUserId', 'requesterSessionId', 'expiresAt'];
      IF p_metadata->>'requesterSessionId' IS NULL
         OR p_metadata->>'requesterSessionId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR p_metadata->>'expiresAt' IS NULL THEN
        RAISE EXCEPTION 'supervisor grant metadata is incomplete' USING ERRCODE = '22023';
      END IF;
      -- The session ID is server-derived from the already authenticated request
      -- context; only its identifier is persisted, never a bearer token.
      PERFORM (p_metadata->>'requesterSessionId')::uuid;
      PERFORM (p_metadata->>'expiresAt')::timestamptz;
  END CASE;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_object_keys(p_metadata) AS item(key)
     WHERE NOT (item.key = ANY(v_allowed_keys))
  ) THEN
    RAISE EXCEPTION 'supervisor audit event metadata contains unsupported fields'
      USING ERRCODE = '22023';
  END IF;

  PERFORM (p_metadata->>'orderId')::uuid;

  INSERT INTO public.prodx_security_audit_events
    (id, organization_id, user_id, event_type, metadata)
  VALUES (p_id, p_organization_id, p_user_id, p_event_type, p_metadata);
END;
$function$;

REVOKE ALL ON FUNCTION public.prodx_record_supervisor_authorization_event(uuid, uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
DO $rpc_revoke$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.prodx_record_supervisor_authorization_event(uuid, uuid, uuid, uuid, text, jsonb) FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$rpc_revoke$;
GRANT EXECUTE ON FUNCTION public.prodx_record_supervisor_authorization_event(uuid, uuid, uuid, uuid, text, jsonb) TO prodx_app;

CREATE OR REPLACE FUNCTION public.prodx_reject_security_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.prodx_organizations o WHERE o.id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'security audit event organization does not exist'
        USING ERRCODE = '23503';
    END IF;

    IF NEW.user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
        FROM public.prodx_users u
       WHERE u.id = NEW.user_id
         AND u.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'security audit event user does not belong to the organization'
        USING ERRCODE = '23503';
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'prodx_security_audit_events is append-only; % is forbidden', TG_OP
    USING ERRCODE = '55000';
END;
$function$;

REVOKE ALL ON FUNCTION public.prodx_reject_security_audit_event_mutation() FROM PUBLIC;

DO $revoke$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'prodx_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.prodx_reject_security_audit_event_mutation() FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$revoke$;

DROP TRIGGER IF EXISTS prodx_security_audit_events_immutable_guard
  ON public.prodx_security_audit_events;

CREATE TRIGGER prodx_security_audit_events_immutable_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.prodx_security_audit_events
  FOR EACH ROW
  EXECUTE FUNCTION public.prodx_reject_security_audit_event_mutation();

ALTER TABLE public.prodx_security_audit_events
  ENABLE ALWAYS TRIGGER prodx_security_audit_events_immutable_guard;

-- Row-level triggers do not fire for TRUNCATE. Protect the ledger from accidental
-- owner-level truncation as well as UPDATE/DELETE; ENABLE ALWAYS also covers
-- sessions using session_replication_role = 'replica'.
DROP TRIGGER IF EXISTS prodx_security_audit_events_no_truncate_guard
  ON public.prodx_security_audit_events;

CREATE TRIGGER prodx_security_audit_events_no_truncate_guard
  BEFORE TRUNCATE ON public.prodx_security_audit_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.prodx_reject_security_audit_event_mutation();

ALTER TABLE public.prodx_security_audit_events
  ENABLE ALWAYS TRIGGER prodx_security_audit_events_no_truncate_guard;

INSERT INTO public.prodx_schema_migrations(version)
VALUES ('0046_security_audit_events_append_only')
ON CONFLICT (version) DO NOTHING;
