-- prodx:non-transactional
-- Single statement per file: CREATE INDEX CONCURRENTLY must not share a query transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS prodx_inventory_ledger_store_created_idx
  ON prodx_inventory_ledger (store_id, created_at DESC);
