-- Preserve the refund/void payment states while admitting M6 lifecycle states.
-- The earlier M3 and M6 migrations each guarded constraint creation independently,
-- leaving whichever constraint was installed first in place. Reconcile the full set.
ALTER TABLE prodx_payments
  DROP CONSTRAINT IF EXISTS prodx_payments_status_valid;

ALTER TABLE prodx_payments
  ADD CONSTRAINT prodx_payments_status_valid
  CHECK (status IN (
    'pending',
    'authorized',
    'captured',
    'settled',
    'failed',
    'cancelled',
    'unknown',
    'voided'
  ));

INSERT INTO prodx_schema_migrations(version)
VALUES ('0063_payment_status_lifecycle_union')
ON CONFLICT (version) DO NOTHING;
