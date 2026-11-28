-- Preserve the exact validated OfflineSale payload for durable failed-sequence recovery.
-- Existing failures are intentionally left NULL: their original payload cannot be
-- reconstructed safely from a hash, and historical append-only rows are not rewritten.
BEGIN;

ALTER TABLE public.terminal_sequence_failures
  ADD COLUMN IF NOT EXISTS sale_snapshot jsonb;

DO $snapshot_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='terminal_sequence_failure_snapshot_shape'
       AND conrelid='public.terminal_sequence_failures'::regclass
  ) THEN
    ALTER TABLE public.terminal_sequence_failures
      ADD CONSTRAINT terminal_sequence_failure_snapshot_shape
      CHECK (
        sale_snapshot IS NULL OR COALESCE(
          jsonb_typeof(sale_snapshot)='object'
          AND sale_snapshot->>'sale_id'=sale_id::text
          AND sale_snapshot->>'idempotency_key'=idempotency_key
          AND sale_snapshot->>'payload_hash'=rtrim(payload_hash::text)
          AND (sale_snapshot->>'terminal_seq_no')::numeric=terminal_seq_no
          AND (sale_snapshot->>'catalog_version')::numeric BETWEEN 1 AND 9007199254740991
          AND sale_snapshot->>'currency'='THB'
          AND jsonb_typeof(sale_snapshot->'hlc')='object'
          AND (sale_snapshot->'hlc'->>'physical_ms')::numeric=hlc_physical_ms
          AND (sale_snapshot->'hlc'->>'logical')::numeric=hlc_logical
          AND CASE WHEN jsonb_typeof(sale_snapshot->'lines')='array'
                   THEN jsonb_array_length(sale_snapshot->'lines') BETWEEN 1 AND 200 ELSE false END
          AND CASE WHEN jsonb_typeof(sale_snapshot->'signed_price_proofs')='array'
                   THEN jsonb_array_length(sale_snapshot->'signed_price_proofs') BETWEEN 1 AND 200 ELSE false END
          AND sale_snapshot->>'client_recorded_at' IS NOT NULL,
          false
        )
      ) NOT VALID;
  END IF;
END
$snapshot_constraint$;

ALTER TABLE public.terminal_sequence_failures
  VALIDATE CONSTRAINT terminal_sequence_failure_snapshot_shape;

COMMIT;
