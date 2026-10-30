-- 0041: persist a semantic request fingerprint for checkout idempotency.
-- Existing orders remain readable, but legacy rows without a fingerprint fail closed
-- on key reuse because their original request cannot be reconstructed reliably.

BEGIN;

ALTER TABLE public.prodx_orders
  ADD COLUMN IF NOT EXISTS idempotency_payload_hash CHAR(64);

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'prodx_orders'
       AND column_name = 'idempotency_payload_hash'
       AND character_maximum_length = 64
  ) THEN
    RAISE EXCEPTION 'Checkout idempotency fingerprint column was not created';
  END IF;
END
$verify$;

COMMENT ON COLUMN public.prodx_orders.idempotency_payload_hash IS
  'SHA-256 fingerprint of the semantic checkout command; NULL only for legacy orders created before migration 0041.';

INSERT INTO public.prodx_schema_migrations(version)
VALUES ('0041_checkout_idempotency_payload_fingerprint')
ON CONFLICT (version) DO NOTHING;

COMMIT;
