-- PRODX POS Store Tenancy Currency Invariant
-- Each store defines its authoritative operating currency (defaults to 'THB').

ALTER TABLE prodx_stores
  ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'THB';

INSERT INTO prodx_schema_migrations(version)
VALUES ('0035_store_currency')
ON CONFLICT(version) DO NOTHING;
