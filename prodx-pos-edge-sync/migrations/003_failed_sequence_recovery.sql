-- Forward-only origin-authoritative recovery for permanently rejected terminal sequences.
-- A committed sale and a voided sequence are distinct outcomes: last_committed_seq_no
-- records real sales; last_resolved_seq_no is the contiguous terminal outcome checkpoint.
BEGIN;
LOCK TABLE public.terminal_sync_state IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.terminal_sync_state
  ADD COLUMN IF NOT EXISTS last_resolved_seq_no bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_resolved_hlc_physical_ms bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_resolved_hlc_logical integer NOT NULL DEFAULT 0;

-- Backfill existing terminals from their authoritative committed checkpoint.
-- On rerun, never roll back a previously advanced resolution checkpoint.
UPDATE public.terminal_sync_state
   SET last_resolved_seq_no = GREATEST(last_resolved_seq_no,last_committed_seq_no),
       last_resolved_hlc_physical_ms = CASE
         WHEN last_resolved_seq_no <= last_committed_seq_no THEN last_hlc_physical_ms
         ELSE last_resolved_hlc_physical_ms END,
       last_resolved_hlc_logical = CASE
         WHEN last_resolved_seq_no <= last_committed_seq_no THEN last_hlc_logical
         ELSE last_resolved_hlc_logical END;

DO $migration_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='terminal_sync_resolved_checkpoint_order' AND conrelid='public.terminal_sync_state'::regclass) THEN
    ALTER TABLE public.terminal_sync_state ADD CONSTRAINT terminal_sync_resolved_checkpoint_order
      CHECK (last_resolved_seq_no BETWEEN last_committed_seq_no AND 9007199254740991);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='terminal_sync_resolved_hlc_safe_integer' AND conrelid='public.terminal_sync_state'::regclass) THEN
    ALTER TABLE public.terminal_sync_state ADD CONSTRAINT terminal_sync_resolved_hlc_safe_integer
      CHECK (last_resolved_hlc_physical_ms BETWEEN 0 AND 9007199254740991 AND last_resolved_hlc_logical >= 0);
  END IF;
END
$migration_constraints$;

CREATE TABLE IF NOT EXISTS public.terminal_sequence_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  terminal_id uuid NOT NULL,
  terminal_seq_no bigint NOT NULL CHECK (terminal_seq_no BETWEEN 1 AND 9007199254740991),
  sale_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 200),
  receipt_id uuid NOT NULL,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  hlc_physical_ms bigint NOT NULL CHECK (hlc_physical_ms BETWEEN 0 AND 9007199254740991),
  hlc_logical integer NOT NULL CHECK (hlc_logical >= 0),
  failure_code text NOT NULL CHECK (failure_code ~ '^[A-Z0-9_]{1,100}$'),
  failure_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  failed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT terminal_sequence_failures_tenant_terminal_sequence_unique
    UNIQUE (tenant_id,terminal_id,terminal_seq_no),
  CONSTRAINT terminal_sequence_failures_tenant_idempotency_unique
    UNIQUE (tenant_id,idempotency_key),
  CONSTRAINT terminal_sequence_failures_tenant_receipt_unique
    UNIQUE (tenant_id,receipt_id)
);

CREATE TABLE IF NOT EXISTS public.terminal_sequence_resolutions (
  resolution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  terminal_id uuid NOT NULL,
  terminal_seq_no bigint NOT NULL,
  failure_id uuid NOT NULL REFERENCES public.terminal_sequence_failures(id),
  idempotency_key text NOT NULL,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  disposition text NOT NULL CHECK (disposition IN ('RETRY','VOID')),
  request_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  actor_subject text NOT NULL CHECK (length(btrim(actor_subject)) BETWEEN 1 AND 255),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT terminal_sequence_resolutions_failure_scope_fk
    FOREIGN KEY (tenant_id,terminal_id,terminal_seq_no)
    REFERENCES public.terminal_sequence_failures(tenant_id,terminal_id,terminal_seq_no),
  CONSTRAINT terminal_sequence_resolutions_request_unique UNIQUE (tenant_id,request_id)
);

CREATE INDEX IF NOT EXISTS idx_terminal_sequence_failures_terminal
  ON public.terminal_sequence_failures(tenant_id,terminal_id,terminal_seq_no);
CREATE INDEX IF NOT EXISTS idx_terminal_sequence_resolutions_latest
  ON public.terminal_sequence_resolutions(tenant_id,terminal_id,terminal_seq_no,created_at DESC,resolution_id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_terminal_sequence_single_void
  ON public.terminal_sequence_resolutions(tenant_id,terminal_id,terminal_seq_no)
  WHERE disposition='VOID';

-- Both tables are append-only audit records. A RETRY is an authorization event;
-- only VOID advances last_resolved_seq_no without creating a sale.
DROP TRIGGER IF EXISTS trg_terminal_sequence_failures_immutable ON public.terminal_sequence_failures;
CREATE TRIGGER trg_terminal_sequence_failures_immutable
BEFORE UPDATE OR DELETE ON public.terminal_sequence_failures
FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_mutation();
DROP TRIGGER IF EXISTS trg_terminal_sequence_resolutions_immutable ON public.terminal_sequence_resolutions;
CREATE TRIGGER trg_terminal_sequence_resolutions_immutable
BEFORE UPDATE OR DELETE ON public.terminal_sequence_resolutions
FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_mutation();

DO $tenant_policies$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['terminal_sequence_failures','terminal_sequence_resolutions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I',t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (tenant_id = NULLIF(current_setting(%L,true),%L)::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(%L,true),%L)::uuid)',
      t,'app.current_tenant_id','','app.current_tenant_id',''
    );
  END LOOP;
END
$tenant_policies$;

COMMIT;
