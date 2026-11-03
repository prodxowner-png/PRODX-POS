-- 0040: restrict destructive DML on append-only cash and payment records.
-- The backend runtime role may still read and append cash movements, but must not
-- rewrite/delete historical drawer movements. Payment lifecycle updates remain
-- available to the authoritative checkout/payment services; hard deletion is denied.
-- This is a forward-only repair for grants left broad by the initial runtime-role grant.

BEGIN;

DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prodx_app') THEN
    RAISE EXCEPTION 'prodx_app runtime role is required';
  END IF;

  IF to_regclass('public.prodx_cash_movements') IS NULL
     OR to_regclass('public.prodx_payments') IS NULL
     OR to_regclass('public.prodx_inventory_ledger') IS NULL
     OR to_regclass('public.prodx_audit_log') IS NULL THEN
    RAISE EXCEPTION 'Required PRODX financial/audit tables are missing; refusing partial security migration';
  END IF;
END
$preflight$;

-- Cash movements are an append-only operational ledger.
REVOKE UPDATE, DELETE ON TABLE public.prodx_cash_movements FROM prodx_app;

-- Payments may transition through the server-authoritative lifecycle, but must
-- never be hard-deleted. Corrections use compensating/refund/reversal records.
REVOKE DELETE ON TABLE public.prodx_payments FROM prodx_app;

-- Keep the already-established ledger and audit log protections explicit.
REVOKE UPDATE, DELETE ON TABLE public.prodx_inventory_ledger FROM prodx_app;
REVOKE UPDATE, DELETE ON TABLE public.prodx_audit_log FROM prodx_app;

DO $verify$
BEGIN
  IF has_table_privilege('prodx_app', 'public.prodx_cash_movements', 'UPDATE')
     OR has_table_privilege('prodx_app', 'public.prodx_cash_movements', 'DELETE') THEN
    RAISE EXCEPTION 'Security gate failed: prodx_app retains UPDATE/DELETE on prodx_cash_movements';
  END IF;

  IF has_table_privilege('prodx_app', 'public.prodx_payments', 'DELETE') THEN
    RAISE EXCEPTION 'Security gate failed: prodx_app retains DELETE on prodx_payments';
  END IF;

  IF has_table_privilege('prodx_app', 'public.prodx_inventory_ledger', 'UPDATE')
     OR has_table_privilege('prodx_app', 'public.prodx_inventory_ledger', 'DELETE') THEN
    RAISE EXCEPTION 'Security gate failed: prodx_app retains UPDATE/DELETE on prodx_inventory_ledger';
  END IF;

  IF has_table_privilege('prodx_app', 'public.prodx_audit_log', 'UPDATE')
     OR has_table_privilege('prodx_app', 'public.prodx_audit_log', 'DELETE') THEN
    RAISE EXCEPTION 'Security gate failed: prodx_app retains UPDATE/DELETE on prodx_audit_log';
  END IF;
END
$verify$;

INSERT INTO public.prodx_schema_migrations(version)
VALUES ('0040_security_append_only_financial_grants')
ON CONFLICT (version) DO NOTHING;

COMMIT;
