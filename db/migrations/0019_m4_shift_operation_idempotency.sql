CREATE TABLE IF NOT EXISTS prodx_shift_operations (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES prodx_organizations(id) ON DELETE RESTRICT,
  store_id UUID NOT NULL,
  shift_id UUID,
  operation_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT prodx_shift_operation_store_org_fk
    FOREIGN KEY (store_id, organization_id) REFERENCES prodx_stores(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_shift_operation_shift_store_fk
    FOREIGN KEY (shift_id, store_id) REFERENCES prodx_shifts(id, store_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_shift_operation_type_valid
    CHECK (operation_type IN ('open_shift','close_shift','cash_movement')),
  CONSTRAINT prodx_shift_operation_key_valid CHECK (length(btrim(idempotency_key)) > 0),
  CONSTRAINT prodx_shift_operation_hash_valid CHECK (length(btrim(payload_hash)) = 64)
);

CREATE UNIQUE INDEX IF NOT EXISTS prodx_shift_operations_store_type_key_idx
  ON prodx_shift_operations(store_id, operation_type, idempotency_key);

CREATE INDEX IF NOT EXISTS prodx_shift_operations_store_created_idx
  ON prodx_shift_operations(store_id, created_at DESC);

INSERT INTO prodx_schema_migrations(version)
VALUES ('0019_m4_shift_operation_idempotency')
ON CONFLICT(version) DO NOTHING;
