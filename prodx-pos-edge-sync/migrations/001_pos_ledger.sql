-- PRODX POS PostgreSQL schema. Apply using your normal PostgreSQL migration tool.
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  sku text NOT NULL,
  name text NOT NULL,
  unit_price_minor bigint NOT NULL,
  CONSTRAINT products_unit_price_safe_integer CHECK (unit_price_minor BETWEEN 0 AND 9007199254740991),
  tax_bps integer NOT NULL CHECK (tax_bps BETWEEN 0 AND 10000),
  version bigint NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, sku),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS pos_idempotency (
  tenant_id uuid NOT NULL,
  terminal_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  receipt_id uuid NOT NULL,
  payload_hash char(64) NOT NULL,
  CONSTRAINT pos_idempotency_payload_hash_format CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  sale_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('PROCESSING','COMMITTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  PRIMARY KEY (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS sales (
  sale_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  terminal_id uuid NOT NULL,
  terminal_seq_no bigint NOT NULL,
  CONSTRAINT sales_terminal_seq_safe_integer CHECK (terminal_seq_no BETWEEN 1 AND 9007199254740991),
  currency char(3) NOT NULL,
  total_minor bigint NOT NULL,
  CONSTRAINT sales_total_safe_integer CHECK (total_minor BETWEEN 0 AND 9007199254740991),
  catalog_version bigint NOT NULL,
  CONSTRAINT sales_catalog_version_positive CHECK (catalog_version > 0),
  hlc_physical_ms bigint NOT NULL DEFAULT 0,
  hlc_logical integer NOT NULL DEFAULT 0,
  CONSTRAINT sales_hlc_safe_integer CHECK (hlc_physical_ms BETWEEN 0 AND 9007199254740991 AND hlc_logical >= 0),
  client_recorded_at timestamptz NOT NULL,
  edge_received_at timestamptz NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sale_id),
  UNIQUE (tenant_id, terminal_id, terminal_seq_no)
);

CREATE TABLE IF NOT EXISTS sale_lines (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_minor bigint NOT NULL,
  tax_bps integer NOT NULL CHECK (tax_bps BETWEEN 0 AND 10000),
  tax_minor bigint NOT NULL,
  catalog_version bigint NOT NULL,
  signed_unit_price_minor bigint NOT NULL,
  signed_price_verified boolean NOT NULL DEFAULT false,
  CONSTRAINT sale_lines_catalog_version_positive CHECK (catalog_version > 0),
  CONSTRAINT sale_lines_price_safe_integer CHECK (
    unit_price_minor BETWEEN 0 AND 9007199254740991 AND
    signed_unit_price_minor BETWEEN 0 AND 9007199254740991 AND
    tax_minor BETWEEN 0 AND 9007199254740991
  ),
  CONSTRAINT sale_lines_signed_price_verified_consistent CHECK (
    NOT signed_price_verified OR (catalog_version > 0 AND signed_unit_price_minor = unit_price_minor)
  ),
  FOREIGN KEY (tenant_id, sale_id) REFERENCES sales(tenant_id, sale_id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS inventory_ledger (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  sale_id uuid,
  terminal_id uuid,
  reference_id uuid NOT NULL DEFAULT gen_random_uuid(),
  quantity_delta integer NOT NULL CHECK (quantity_delta <> 0),
  reason text NOT NULL,
  CONSTRAINT inventory_ledger_reason_allowed CHECK (reason IN ('POS_SALE','OPENING_BALANCE','STOCK_ADJUSTMENT','PURCHASE_RECEIPT','CUSTOMER_RETURN','SUPPLIER_RETURN','VOID_REVERSAL')),
  CONSTRAINT inventory_ledger_source_shape CHECK (
    (reason='POS_SALE' AND sale_id IS NOT NULL AND terminal_id IS NOT NULL) OR
    (reason<>'POS_SALE' AND sale_id IS NULL)
  ),
  CONSTRAINT inventory_ledger_opening_positive CHECK (reason<>'OPENING_BALANCE' OR quantity_delta>0),
  CONSTRAINT inventory_ledger_reason_sign CHECK (
    (reason='POS_SALE' AND quantity_delta<0) OR
    (reason IN ('OPENING_BALANCE','PURCHASE_RECEIPT','CUSTOMER_RETURN') AND quantity_delta>0) OR
    (reason='SUPPLIER_RETURN' AND quantity_delta<0) OR
    (reason IN ('STOCK_ADJUSTMENT','VOID_REVERSAL') AND quantity_delta<>0)
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, sale_id) REFERENCES sales(tenant_id, sale_id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS inventory_balances (
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, product_id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  actor_type text NOT NULL,
  actor_id uuid NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  payload_hash char(64) NOT NULL,
  CONSTRAINT audit_logs_payload_hash_format CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  catalog_version bigint,
  metadata jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION apply_inventory_ledger_delta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $
DECLARE
  current_balance bigint;
BEGIN
  PERFORM 1
    FROM public.products
   WHERE tenant_id=NEW.tenant_id AND id=NEW.product_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='PZ002', MESSAGE='INVENTORY_PRODUCT_NOT_FOUND';
  END IF;

  SELECT quantity INTO current_balance
    FROM public.inventory_balances
   WHERE tenant_id=NEW.tenant_id AND product_id=NEW.product_id
   FOR UPDATE;

  IF COALESCE(current_balance,0)::numeric + NEW.quantity_delta::numeric < 0 THEN
    RAISE EXCEPTION USING ERRCODE='PZ001', MESSAGE='INSUFFICIENT_STOCK';
  END IF;

  INSERT INTO public.inventory_balances(tenant_id,product_id,quantity,updated_at)
  VALUES(NEW.tenant_id,NEW.product_id,NEW.quantity_delta,now())
  ON CONFLICT (tenant_id,product_id)
  DO UPDATE SET quantity=public.inventory_balances.quantity+EXCLUDED.quantity,
                updated_at=now();
  RETURN NEW;
END;
$;
REVOKE ALL ON FUNCTION apply_inventory_ledger_delta() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_apply_inventory_ledger_delta ON inventory_ledger;
CREATE TRIGGER trg_apply_inventory_ledger_delta
AFTER INSERT ON inventory_ledger
FOR EACH ROW EXECUTE FUNCTION apply_inventory_ledger_delta();

CREATE INDEX IF NOT EXISTS idx_products_catalog
  ON products(tenant_id, id) WHERE active=true;
CREATE INDEX IF NOT EXISTS idx_sales_terminal_sequence
  ON sales(tenant_id, terminal_id, terminal_seq_no);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_product
  ON inventory_ledger(tenant_id, product_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_ledger_sale_product_reason
  ON inventory_ledger(tenant_id, sale_id, product_id, reason);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs(tenant_id, entity_type, entity_id, id);

-- Append-only enforcement for financial and audit history.
CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: mutation is forbidden';
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_immutable ON sales;
CREATE TRIGGER trg_sales_immutable
BEFORE UPDATE OR DELETE ON sales
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

DROP TRIGGER IF EXISTS trg_sale_lines_immutable ON sale_lines;
CREATE TRIGGER trg_sale_lines_immutable
BEFORE UPDATE OR DELETE ON sale_lines
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

DROP TRIGGER IF EXISTS trg_inventory_ledger_immutable ON inventory_ledger;
CREATE TRIGGER trg_inventory_ledger_immutable
BEFORE UPDATE OR DELETE ON inventory_ledger
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();



-- Monotonic tenant catalog revision; changed product pricing/availability advances it.
CREATE TABLE IF NOT EXISTS terminal_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  terminal_id uuid NOT NULL,
  cert_fingerprint_sha256 char(64) NOT NULL CHECK (cert_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  active boolean NOT NULL DEFAULT true,
  not_before timestamptz NOT NULL DEFAULT now(),
  not_after timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,terminal_id,cert_fingerprint_sha256),
  UNIQUE (cert_fingerprint_sha256)
);
CREATE INDEX IF NOT EXISTS idx_terminal_devices_active
  ON terminal_devices(tenant_id,terminal_id,cert_fingerprint_sha256) WHERE active=true AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS tenant_catalog_versions (
  tenant_id uuid PRIMARY KEY,
  catalog_version bigint NOT NULL DEFAULT 1,
  CONSTRAINT tenant_catalog_version_safe_integer CHECK (catalog_version BETWEEN 1 AND 9007199254740991),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS terminal_sync_state (
  tenant_id uuid NOT NULL,
  terminal_id uuid NOT NULL,
  last_committed_seq_no bigint NOT NULL DEFAULT 0 CHECK (last_committed_seq_no >= 0),
  last_hlc_physical_ms bigint NOT NULL DEFAULT 0,
  last_hlc_logical integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, terminal_id)
);
ALTER TABLE pos_idempotency ADD COLUMN IF NOT EXISTS terminal_id uuid;
ALTER TABLE pos_idempotency ADD COLUMN IF NOT EXISTS receipt_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_idempotency_receipt
  ON pos_idempotency(tenant_id,receipt_id) WHERE receipt_id IS NOT NULL;
UPDATE pos_idempotency p SET terminal_id=s.terminal_id
  FROM sales s WHERE p.tenant_id=s.tenant_id AND p.sale_id=s.sale_id AND p.terminal_id IS NULL;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS hlc_physical_ms bigint NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS hlc_logical integer NOT NULL DEFAULT 0;
ALTER TABLE sale_lines ADD COLUMN IF NOT EXISTS catalog_version bigint NOT NULL DEFAULT 1;
ALTER TABLE sale_lines ADD COLUMN IF NOT EXISTS signed_unit_price_minor bigint NOT NULL DEFAULT 0;
ALTER TABLE sale_lines ADD COLUMN IF NOT EXISTS signed_price_verified boolean NOT NULL DEFAULT false;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS catalog_version bigint;
ALTER TABLE inventory_ledger ALTER COLUMN sale_id DROP NOT NULL;
ALTER TABLE inventory_ledger ALTER COLUMN terminal_id DROP NOT NULL;
ALTER TABLE inventory_ledger ADD COLUMN IF NOT EXISTS reference_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_ledger_reference_product_reason
  ON inventory_ledger(tenant_id,reference_id,product_id,reason);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='terminal_devices_fingerprint_format' AND conrelid='terminal_devices'::regclass) THEN
    ALTER TABLE terminal_devices ADD CONSTRAINT terminal_devices_fingerprint_format
      CHECK (cert_fingerprint_sha256 ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pos_idempotency_terminal_receipt_required' AND conrelid='pos_idempotency'::regclass) THEN
    ALTER TABLE pos_idempotency ADD CONSTRAINT pos_idempotency_terminal_receipt_required
      CHECK (terminal_id IS NOT NULL AND receipt_id IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pos_idempotency_payload_hash_format' AND conrelid='pos_idempotency'::regclass) THEN
    ALTER TABLE pos_idempotency ADD CONSTRAINT pos_idempotency_payload_hash_format
      CHECK (payload_hash ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='audit_logs_payload_hash_format' AND conrelid='audit_logs'::regclass) THEN
    ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_payload_hash_format
      CHECK (payload_hash ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='products_unit_price_safe_integer' AND conrelid='products'::regclass) THEN
    ALTER TABLE products ADD CONSTRAINT products_unit_price_safe_integer
      CHECK (unit_price_minor BETWEEN 0 AND 9007199254740991);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='products_version_positive' AND conrelid='products'::regclass) THEN
    ALTER TABLE products ADD CONSTRAINT products_version_positive CHECK (version > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tenant_catalog_version_safe_integer' AND conrelid='tenant_catalog_versions'::regclass) THEN
    ALTER TABLE tenant_catalog_versions ADD CONSTRAINT tenant_catalog_version_safe_integer
      CHECK (catalog_version BETWEEN 1 AND 9007199254740991);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sales_total_safe_integer' AND conrelid='sales'::regclass) THEN
    ALTER TABLE sales ADD CONSTRAINT sales_total_safe_integer
      CHECK (total_minor BETWEEN 0 AND 9007199254740991);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sales_terminal_seq_safe_integer' AND conrelid='sales'::regclass) THEN
    ALTER TABLE sales ADD CONSTRAINT sales_terminal_seq_safe_integer
      CHECK (terminal_seq_no BETWEEN 1 AND 9007199254740991);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sales_catalog_version_positive' AND conrelid='sales'::regclass) THEN
    ALTER TABLE sales ADD CONSTRAINT sales_catalog_version_positive CHECK (catalog_version > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sales_hlc_safe_integer' AND conrelid='sales'::regclass) THEN
    ALTER TABLE sales ADD CONSTRAINT sales_hlc_safe_integer
      CHECK (hlc_physical_ms BETWEEN 0 AND 9007199254740991 AND hlc_logical >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sale_lines_catalog_version_positive' AND conrelid='sale_lines'::regclass) THEN
    ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_catalog_version_positive CHECK (catalog_version > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sale_lines_price_safe_integer' AND conrelid='sale_lines'::regclass) THEN
    ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_price_safe_integer
      CHECK (unit_price_minor BETWEEN 0 AND 9007199254740991 AND
             signed_unit_price_minor BETWEEN 0 AND 9007199254740991 AND
             tax_minor BETWEEN 0 AND 9007199254740991);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sale_lines_signed_price_verified_consistent' AND conrelid='sale_lines'::regclass) THEN
    ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_signed_price_verified_consistent
      CHECK (NOT signed_price_verified OR
        (catalog_version > 0 AND signed_unit_price_minor = unit_price_minor));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_ledger_reason_allowed' AND conrelid='inventory_ledger'::regclass) THEN
    ALTER TABLE inventory_ledger ADD CONSTRAINT inventory_ledger_reason_allowed
      CHECK (reason IN ('POS_SALE','OPENING_BALANCE','STOCK_ADJUSTMENT','PURCHASE_RECEIPT','CUSTOMER_RETURN','SUPPLIER_RETURN','VOID_REVERSAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_ledger_source_shape' AND conrelid='inventory_ledger'::regclass) THEN
    ALTER TABLE inventory_ledger ADD CONSTRAINT inventory_ledger_source_shape
      CHECK ((reason='POS_SALE' AND sale_id IS NOT NULL AND terminal_id IS NOT NULL) OR
             (reason<>'POS_SALE' AND sale_id IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_ledger_opening_positive' AND conrelid='inventory_ledger'::regclass) THEN
    ALTER TABLE inventory_ledger ADD CONSTRAINT inventory_ledger_opening_positive
      CHECK (reason<>'OPENING_BALANCE' OR quantity_delta>0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_ledger_reason_sign' AND conrelid='inventory_ledger'::regclass) THEN
    ALTER TABLE inventory_ledger ADD CONSTRAINT inventory_ledger_reason_sign CHECK (
      (reason='POS_SALE' AND quantity_delta<0) OR
      (reason IN ('OPENING_BALANCE','PURCHASE_RECEIPT','CUSTOMER_RETURN') AND quantity_delta>0) OR
      (reason='SUPPLIER_RETURN' AND quantity_delta<0) OR
      (reason IN ('STOCK_ADJUSTMENT','VOID_REVERSAL') AND quantity_delta<>0)
    );
  END IF;
END $$;

WITH distinct_sequences AS (
  SELECT DISTINCT tenant_id,terminal_id,terminal_seq_no FROM sales
), ranked_sequences AS (
  SELECT tenant_id,terminal_id,terminal_seq_no,
         ROW_NUMBER() OVER (PARTITION BY tenant_id,terminal_id ORDER BY terminal_seq_no) AS ordinal
  FROM distinct_sequences
), checkpoints AS (
  SELECT tenant_id,terminal_id,
         COALESCE(MAX(terminal_seq_no) FILTER (WHERE terminal_seq_no=ordinal),0) AS last_contiguous_seq_no
  FROM ranked_sequences GROUP BY tenant_id,terminal_id
)
INSERT INTO terminal_sync_state(tenant_id,terminal_id,last_committed_seq_no,last_hlc_physical_ms,last_hlc_logical)
SELECT c.tenant_id,c.terminal_id,c.last_contiguous_seq_no,
       COALESCE(s.hlc_physical_ms,0),COALESCE(s.hlc_logical,0)
FROM checkpoints c
LEFT JOIN sales s ON s.tenant_id=c.tenant_id AND s.terminal_id=c.terminal_id
                 AND s.terminal_seq_no=c.last_contiguous_seq_no
ON CONFLICT (tenant_id,terminal_id) DO UPDATE
  SET last_committed_seq_no=EXCLUDED.last_committed_seq_no,
      last_hlc_physical_ms=EXCLUDED.last_hlc_physical_ms,
      last_hlc_logical=EXCLUDED.last_hlc_logical,
      updated_at=now();
INSERT INTO tenant_catalog_versions(tenant_id, catalog_version)
SELECT tenant_id, GREATEST(COALESCE(MAX(version),1),1) FROM products GROUP BY tenant_id
ON CONFLICT (tenant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION increment_product_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.sku,NEW.name,NEW.unit_price_minor,NEW.tax_bps,NEW.active)
     IS DISTINCT FROM (OLD.sku,OLD.name,OLD.unit_price_minor,OLD.tax_bps,OLD.active) THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION increment_product_version() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_products_version ON products;
CREATE TRIGGER trg_products_version
BEFORE UPDATE OF sku,name,unit_price_minor,tax_bps,active ON products
FOR EACH ROW EXECUTE FUNCTION increment_product_version();

CREATE OR REPLACE FUNCTION bump_tenant_catalog_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE affected_tenant uuid;
BEGIN
  affected_tenant := COALESCE(NEW.tenant_id, OLD.tenant_id);
  INSERT INTO tenant_catalog_versions(tenant_id,catalog_version,updated_at)
  VALUES (affected_tenant,2,now())
  ON CONFLICT (tenant_id) DO UPDATE
    SET catalog_version=tenant_catalog_versions.catalog_version+1, updated_at=now();
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION bump_tenant_catalog_version() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_products_catalog_version ON products;
CREATE TRIGGER trg_products_catalog_version
AFTER INSERT OR UPDATE OF sku,name,unit_price_minor,tax_bps,active,version OR DELETE ON products
FOR EACH ROW EXECUTE FUNCTION bump_tenant_catalog_version();


-- Strict tenant isolation. The application DB role must NOT have BYPASSRLS.
-- FORCE ROW LEVEL SECURITY also subjects table owners to policies (superusers
-- and BYPASSRLS roles remain privileged and must never be used by the Worker).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','sales','sale_lines','pos_idempotency',
    'inventory_ledger','inventory_balances','audit_logs','tenant_catalog_versions','terminal_sync_state','terminal_devices'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(%L, true), %L)::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(%L, true), %L)::uuid)',
      t, 'app.current_tenant_id', '', 'app.current_tenant_id', ''
    );
  END LOOP;
END $$;

-- Worker runtime role example (create separately with a secure password):
-- ALTER ROLE prodx_pos_worker NOBYPASSRLS;
-- GRANT SELECT ON products, tenant_catalog_versions, terminal_devices TO prodx_pos_worker;
-- Separate tenant-scoped device-admin role manages certificate enrollment/revocation:
-- GRANT SELECT, INSERT, UPDATE ON terminal_devices TO prodx_device_admin;
-- Product-catalog writer role (separate from POS Worker) also needs:
-- GRANT SELECT, INSERT, UPDATE ON tenant_catalog_versions TO prodx_catalog_writer;
-- GRANT INSERT ON sales, sale_lines, inventory_ledger, audit_logs TO prodx_pos_worker;
-- GRANT SELECT, INSERT, UPDATE ON pos_idempotency, terminal_sync_state TO prodx_pos_worker;
-- GRANT SELECT ON inventory_balances TO prodx_pos_worker; -- balance writes occur only via ledger trigger
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prodx_pos_worker;
-- REVOKE UPDATE, DELETE, TRUNCATE ON sales, sale_lines, inventory_ledger, audit_logs FROM prodx_pos_worker;
