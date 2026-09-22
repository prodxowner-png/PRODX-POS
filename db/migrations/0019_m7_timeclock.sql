CREATE TABLE IF NOT EXISTS prodx_timeclock_records (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES prodx_organizations(id) ON DELETE RESTRICT,
  store_id UUID NOT NULL,
  user_id UUID NOT NULL,
  shift_id UUID,
  status TEXT NOT NULL DEFAULT 'clocked_in',
  clocked_in_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  clocked_out_at TIMESTAMPTZ,
  CONSTRAINT prodx_timeclock_store_org_fk FOREIGN KEY (store_id, organization_id) REFERENCES prodx_stores(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_timeclock_user_org_fk FOREIGN KEY (user_id, organization_id) REFERENCES prodx_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_timeclock_shift_store_fk FOREIGN KEY (shift_id, store_id) REFERENCES prodx_shifts(id, store_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_timeclock_status_valid CHECK (status IN ('clocked_in','clocked_out')),
  CONSTRAINT prodx_timeclock_closed_fields_valid CHECK ((status='clocked_in' AND clocked_out_at IS NULL) OR (status='clocked_out' AND clocked_out_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS prodx_timeclock_one_open_user ON prodx_timeclock_records(store_id,user_id) WHERE status='clocked_in';
CREATE INDEX IF NOT EXISTS prodx_timeclock_store_time_idx ON prodx_timeclock_records(store_id,clocked_in_at DESC);
INSERT INTO prodx_schema_migrations(version) VALUES ('0019_m7_timeclock') ON CONFLICT(version) DO NOTHING;
