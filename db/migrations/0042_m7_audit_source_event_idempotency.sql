-- M7: idempotency key for retried browser diagnostic batches.
ALTER TABLE public.prodx_audit_log
  ADD COLUMN IF NOT EXISTS source_event_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS prodx_audit_log_source_event_unique
  ON public.prodx_audit_log (organization_id, store_id, source_event_key)
  WHERE source_event_key IS NOT NULL;

INSERT INTO public.prodx_schema_migrations(version)
VALUES ('0042_m7_audit_source_event_idempotency')
ON CONFLICT (version) DO NOTHING;
