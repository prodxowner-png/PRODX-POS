-- prodx:non-transactional
CREATE INDEX CONCURRENTLY IF NOT EXISTS prodx_inventory_ledger_store_product_created_idx
  ON prodx_inventory_ledger (store_id, product_id, created_at DESC);
