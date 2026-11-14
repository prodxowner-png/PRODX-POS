-- Append-only audit of each authorized RETRY attempt that fails again.
-- A RETRY resolution authorizes one exact receipt delivery generation. If that
-- generation fails, later stale Queue/DLQ deliveries must not re-arm it.
BEGIN;

CREATE TABLE IF NOT EXISTS public.terminal_sequence_retry_failures (
  retry_failure_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  terminal_id uuid NOT NULL,
  terminal_seq_no bigint NOT NULL CHECK (terminal_seq_no BETWEEN 1 AND 9007199254740991),
  failure_id uuid NOT NULL REFERENCES public.terminal_sequence_failures(id),
  resolution_id uuid NOT NULL REFERENCES public.terminal_sequence_resolutions(resolution_id),
  idempotency_key text NOT NULL,
  receipt_id uuid NOT NULL,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  failure_code text NOT NULL CHECK (failure_code ~ '^[A-Z0-9_]{1,100}$'),
  failure_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  failed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT terminal_sequence_retry_failure_scope_fk
    FOREIGN KEY (tenant_id,terminal_id,terminal_seq_no)
    REFERENCES public.terminal_sequence_failures(tenant_id,terminal_id,terminal_seq_no),
  CONSTRAINT terminal_sequence_retry_failure_resolution_receipt_unique
    UNIQUE (resolution_id,receipt_id)
);

CREATE INDEX IF NOT EXISTS idx_terminal_sequence_retry_failures_latest
  ON public.terminal_sequence_retry_failures(tenant_id,terminal_id,terminal_seq_no,failed_at DESC);

DROP TRIGGER IF EXISTS trg_terminal_sequence_retry_failures_immutable
  ON public.terminal_sequence_retry_failures;
CREATE TRIGGER trg_terminal_sequence_retry_failures_immutable
BEFORE UPDATE OR DELETE ON public.terminal_sequence_retry_failures
FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_mutation();

ALTER TABLE public.terminal_sequence_retry_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terminal_sequence_retry_failures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.terminal_sequence_retry_failures;
CREATE POLICY tenant_isolation ON public.terminal_sequence_retry_failures
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid);

COMMIT;
