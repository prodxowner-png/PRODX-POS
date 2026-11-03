\set ON_ERROR_STOP on
-- Required psql variables: tenant_id, product_id, quantity_delta (non-zero signed int),
-- reason (STOCK_ADJUSTMENT/PURCHASE_RECEIPT/CUSTOMER_RETURN/SUPPLIER_RETURN/VOID_REVERSAL),
-- actor_id, adjustment_id (UUID), payload_hash (SHA-256 hex of canonical adjustment payload).
BEGIN;
SELECT set_config('app.current_tenant_id', :'tenant_id', true);
INSERT INTO inventory_ledger(
  tenant_id,product_id,sale_id,terminal_id,reference_id,quantity_delta,reason
) VALUES (
  :'tenant_id'::uuid,:'product_id'::uuid,NULL,NULL,:'adjustment_id'::uuid,
  :'quantity_delta'::integer,:'reason'
);
-- AFTER INSERT trigger applies the delta to inventory_balances in this transaction.
INSERT INTO audit_logs(
  tenant_id,actor_type,actor_id,action,entity_type,entity_id,payload_hash,catalog_version,metadata
) VALUES (
  :'tenant_id'::uuid,'USER',:'actor_id'::uuid,'INVENTORY_ADJUSTMENT_RECORDED',
  'INVENTORY_ADJUSTMENT',:'adjustment_id'::uuid,lower(:'payload_hash'),NULL,
  jsonb_build_object('product_id',:'product_id'::uuid,'quantity_delta',:'quantity_delta'::integer,'reason',:'reason')
);
COMMIT;
