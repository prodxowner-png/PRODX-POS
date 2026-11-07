-- prodx:non-transactional
CREATE INDEX CONCURRENTLY IF NOT EXISTS prodx_products_store_category_active_name_idx
  ON prodx_products (store_id, category_id, active, name);
