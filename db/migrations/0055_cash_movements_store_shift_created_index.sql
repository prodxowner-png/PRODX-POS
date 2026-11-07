-- prodx:non-transactional
CREATE INDEX CONCURRENTLY IF NOT EXISTS prodx_cash_movements_store_shift_created_idx
  ON prodx_cash_movements (store_id, shift_id, created_at DESC);
