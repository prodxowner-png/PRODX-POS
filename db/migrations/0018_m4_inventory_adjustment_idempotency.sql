-- Inventory adjustment idempotency and audit operation boundary.
CREATE TABLE IF NOT EXISTS prodx_inventory_adjustments (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES prodx_organizations(id) ON DELETE RESTRICT,
  store_id UUID NOT NULL,
  performed_by_user_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT prodx_inventory_adjustment_store_org_fk
    FOREIGN KEY (store_id, organization_id) REFERENCES prodx_stores(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_inventory_adjustment_user_store_fk
    FOREIGN KEY (organization_id, store_id, performed_by_user_id)
    REFERENCES prodx_store_memberships(organization_id, store_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_inventory_adjustment_key_valid CHECK (length(btrim(idempotency_key)) > 0),
  CONSTRAINT prodx_inventory_adjustment_hash_valid CHECK (length(btrim(payload_hash)) = 64)
);

CREATE UNIQUE INDEX IF NOT EXISTS prodx_inventory_adjustments_store_key_idx
  ON prodx_inventory_adjustments(store_id, idempotency_key);

CREATE INDEX IF NOT EXISTS prodx_inventory_adjustments_store_created_idx
  ON prodx_inventory_adjustments(store_id, created_at DESC);

INSERT INTO prodx_schema_migrations(version)
VALUES ('0018_m4_inventory_adjustment_idempotency')
ON CONFLICT(version) DO NOTHING;
