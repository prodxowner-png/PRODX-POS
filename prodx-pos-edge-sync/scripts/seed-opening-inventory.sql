\set ON_ERROR_STOP on
-- Required psql variables: tenant_id, store_id, product_id, quantity_delta (>0), actor_id,
-- adjustment_id (UUID), payload_hash (SHA-256 hex of the canonical adjustment payload).
BEGIN;
SELECT set_config('app.current_tenant_id', :'tenant_id', true);
SELECT set_config('app.inventory_actor_id', :'actor_id', true);
SELECT set_config('app.inventory_payload_hash', lower(:'payload_hash'), true);
INSERT INTO inventory_ledger(
  tenant_id,store_id,product_id,sale_id,terminal_id,reference_id,quantity_delta,reason
) VALUES (
  :'tenant_id'::uuid,:'store_id'::uuid,:'product_id'::uuid,NULL,NULL,:'adjustment_id'::uuid,
  :'quantity_delta'::integer,'OPENING_BALANCE'
);
-- BEFORE INSERT trigger applies the ledger delta to inventory_balances in this transaction.
-- The ledger trigger appends the matching immutable audit event atomically.
COMMIT;
