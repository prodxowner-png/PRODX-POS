-- M2 catalog read-path indexes. PostgreSQL remains authoritative for tenant/store catalog reads.
CREATE INDEX IF NOT EXISTS prodx_products_store_active_name_idx ON prodx_products(store_id, active, name, id);
CREATE INDEX IF NOT EXISTS prodx_products_store_barcode_active_idx ON prodx_products(store_id, barcode) WHERE active=true;
CREATE INDEX IF NOT EXISTS prodx_categories_store_name_idx ON prodx_categories(store_id, name, id);
INSERT INTO prodx_schema_migrations(version) VALUES ('0014_m2_catalog_read_indexes') ON CONFLICT(version) DO NOTHING;
