-- prodx:non-transactional
CREATE INDEX CONCURRENTLY IF NOT EXISTS prodx_products_store_lower_sku_active_idx
  ON prodx_products (store_id, lower(sku), active);
