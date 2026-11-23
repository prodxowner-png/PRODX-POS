-- 0062: Durable payment webhook replay inbox + FORCE RLS on prodx_supervisor_authorizations.
-- Enforces:
--   1. Deduplicated, append-only (no-DELETE) webhook event inbox with UNIQUE (provider, provider_event_id),
--      SHA-256 payload hash validation, and tenant-scoped RLS + FORCE ROW LEVEL SECURITY.
--   2. Narrow SECURITY DEFINER RPCs so least-privileged prodx_app can safely ingest signed webhooks
--      before tenant session context is established, without weakening RLS on tenant tables.
--   3. FORCE ROW LEVEL SECURITY on public.prodx_supervisor_authorizations (closing Priority 3 gap).

CREATE TABLE IF NOT EXISTS public.prodx_payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  organization_id UUID REFERENCES public.prodx_organizations(id) ON DELETE RESTRICT,
  store_id UUID,
  payment_id UUID,
  provider_reference TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  failure_reason TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ,
  CONSTRAINT prodx_payment_webhook_events_provider_valid CHECK (length(btrim(provider)) > 0),
  CONSTRAINT prodx_payment_webhook_events_event_id_valid CHECK (length(btrim(provider_event_id)) > 0),
  CONSTRAINT prodx_payment_webhook_events_event_type_valid CHECK (length(btrim(event_type)) > 0),
  CONSTRAINT prodx_payment_webhook_events_payload_sha256_valid CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT prodx_payment_webhook_events_status_valid CHECK (status IN ('received', 'processed', 'ignored', 'rejected')),
  CONSTRAINT prodx_payment_webhook_events_tenant_pair_valid CHECK ((organization_id IS NULL) = (store_id IS NULL)),
  CONSTRAINT prodx_payment_webhook_events_store_org_fk FOREIGN KEY (store_id, organization_id) REFERENCES public.prodx_stores(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_payment_webhook_events_payment_store_fk FOREIGN KEY (payment_id, store_id) REFERENCES public.prodx_payments(id, store_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_payment_webhook_events_provider_event_unique UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS prodx_payment_webhook_events_store_idx
  ON public.prodx_payment_webhook_events (organization_id, store_id, received_at DESC)
  WHERE store_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS prodx_payment_webhook_events_provider_ref_idx
  ON public.prodx_payment_webhook_events (provider, provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prodx_payment_webhook_events_no_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger$
BEGIN
  RAISE EXCEPTION 'prodx_payment_webhook_events is append-only; DELETE is not permitted'
    USING ERRCODE = '42501';
END;
$trigger$;

DROP TRIGGER IF EXISTS prodx_payment_webhook_events_no_delete_guard ON public.prodx_payment_webhook_events;
CREATE TRIGGER prodx_payment_webhook_events_no_delete_guard
  BEFORE DELETE ON public.prodx_payment_webhook_events
  FOR EACH ROW
  EXECUTE FUNCTION public.prodx_payment_webhook_events_no_delete();

-- Atomically record a verified webhook event into the replay inbox.
-- Returns inserted = true on first delivery, inserted = false on duplicate replay.
CREATE OR REPLACE FUNCTION public.prodx_payment_webhook_record_event(
  p_provider TEXT,
  p_provider_event_id TEXT,
  p_event_type TEXT,
  p_payload_sha256 TEXT,
  p_provider_reference TEXT DEFAULT NULL
)
RETURNS TABLE(event_row_id UUID, inserted BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF p_provider IS NULL OR length(btrim(p_provider)) = 0
     OR p_provider_event_id IS NULL OR length(btrim(p_provider_event_id)) = 0
     OR p_event_type IS NULL OR length(btrim(p_event_type)) = 0
     OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid payment webhook event payload' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.prodx_payment_webhook_events (
    provider,
    provider_event_id,
    event_type,
    payload_sha256,
    provider_reference,
    status
  )
  VALUES (
    btrim(p_provider),
    btrim(p_provider_event_id),
    btrim(p_event_type),
    p_payload_sha256,
    NULLIF(btrim(COALESCE(p_provider_reference, '')), ''),
    'received'
  )
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, TRUE;
    RETURN;
  END IF;

  SELECT e.id INTO v_id
    FROM public.prodx_payment_webhook_events e
   WHERE e.provider = btrim(p_provider)
     AND e.provider_event_id = btrim(p_provider_event_id)
   LIMIT 1;

  RETURN QUERY SELECT v_id, FALSE;
END;
$function$;

-- Resolve the owning tenant and payment row for a verified provider webhook event.
CREATE OR REPLACE FUNCTION public.prodx_payment_webhook_resolve_target(
  p_provider TEXT,
  p_provider_reference TEXT,
  p_payment_id UUID DEFAULT NULL
)
RETURNS TABLE(
  organization_id UUID,
  store_id UUID,
  order_id UUID,
  payment_id UUID,
  status TEXT,
  provider TEXT,
  provider_reference TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_ref TEXT := NULLIF(btrim(COALESCE(p_provider_reference, '')), '');
  v_provider TEXT := NULLIF(btrim(COALESCE(p_provider, '')), '');
BEGIN
  IF v_provider IS NULL OR (v_ref IS NULL AND p_payment_id IS NULL) THEN
    RETURN;
  END IF;

  IF v_ref IS NOT NULL THEN
    RETURN QUERY
      SELECT p.organization_id, p.store_id, p.order_id, p.id, p.status, p.provider, p.provider_reference
        FROM public.prodx_payments p
       WHERE p.provider_reference = v_ref
         AND (p.provider = v_provider OR p.provider = 'internal')
         AND (p_payment_id IS NULL OR p.id = p_payment_id)
       ORDER BY p.created_at DESC
       LIMIT 1;
    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  IF p_payment_id IS NOT NULL THEN
    RETURN QUERY
      SELECT p.organization_id, p.store_id, p.order_id, p.id, p.status, p.provider, p.provider_reference
        FROM public.prodx_payments p
       WHERE p.id = p_payment_id
         AND (p.provider_reference IS NULL OR v_ref IS NULL OR p.provider_reference = v_ref)
       LIMIT 1;
  END IF;
END;
$function$;

-- Finalize webhook event processing status (processed / ignored / rejected) with optional tenant attribution.
CREATE OR REPLACE FUNCTION public.prodx_payment_webhook_update_status(
  p_event_row_id UUID,
  p_status TEXT,
  p_organization_id UUID DEFAULT NULL,
  p_store_id UUID DEFAULT NULL,
  p_payment_id UUID DEFAULT NULL,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_event_row_id IS NULL OR p_status NOT IN ('processed', 'ignored', 'rejected') THEN
    RAISE EXCEPTION 'Invalid payment webhook status update' USING ERRCODE = '22023';
  END IF;

  UPDATE public.prodx_payment_webhook_events
     SET status = p_status,
         organization_id = COALESCE(p_organization_id, organization_id),
         store_id = COALESCE(p_store_id, store_id),
         payment_id = COALESCE(p_payment_id, payment_id),
         failure_reason = p_failure_reason,
         processed_at = CURRENT_TIMESTAMP
   WHERE id = p_event_row_id;
END;
$function$;

ALTER TABLE public.prodx_payment_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prodx_payment_webhook_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prodx_app_tenant_isolation ON public.prodx_payment_webhook_events;
CREATE POLICY prodx_app_tenant_isolation ON public.prodx_payment_webhook_events
  FOR ALL TO prodx_app
  USING (
    organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
    AND store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
    AND store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
  );

REVOKE ALL ON TABLE public.prodx_payment_webhook_events FROM PUBLIC;
REVOKE ALL ON TABLE public.prodx_payment_webhook_events FROM prodx_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.prodx_payment_webhook_events TO prodx_app;

REVOKE ALL ON FUNCTION public.prodx_payment_webhook_record_event(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prodx_payment_webhook_resolve_target(TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prodx_payment_webhook_update_status(UUID, TEXT, UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prodx_payment_webhook_record_event(TEXT, TEXT, TEXT, TEXT, TEXT) TO prodx_app;
GRANT EXECUTE ON FUNCTION public.prodx_payment_webhook_resolve_target(TEXT, TEXT, UUID) TO prodx_app;
GRANT EXECUTE ON FUNCTION public.prodx_payment_webhook_update_status(UUID, TEXT, UUID, UUID, UUID, TEXT) TO prodx_app;

-- Priority 3 hardening: enforce FORCE ROW LEVEL SECURITY on supervisor authorizations.
ALTER TABLE public.prodx_supervisor_authorizations FORCE ROW LEVEL SECURITY;

INSERT INTO public.prodx_schema_migrations(version)
VALUES ('0062_payment_webhook_inbox_and_discount_force_rls')
ON CONFLICT (version) DO NOTHING;
