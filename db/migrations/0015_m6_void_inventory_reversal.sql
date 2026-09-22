-- Allow inventory ledger entries that reverse stock for an authorized void.
ALTER TABLE prodx_inventory_ledger DROP CONSTRAINT IF EXISTS prodx_inventory_reason_valid;
ALTER TABLE prodx_inventory_ledger ADD CONSTRAINT prodx_inventory_reason_valid
  CHECK (reason IN ('sale_deduction','refund_restock','void_reversal','purchase_received','transfer_in','transfer_out','audit_count_adjustment','damaged_write_off'));
INSERT INTO prodx_schema_migrations(version) VALUES ('0015_m6_void_inventory_reversal') ON CONFLICT(version) DO NOTHING;
