-- Store-scoped inventory and database-enforced negative-stock policy.
-- Apply only after reviewing/backing up the target database. This migration is additive
-- for store identity; existing tenant-wide inventory is assigned to one default store
-- per tenant because the previous Edge schema did not retain historical store identity.
BEGIN;

CREATE TABLE IF NOT EXISTS pos_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_stores_one_default_per_tenant
  ON pos_stores(tenant_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS store_inventory_settings (
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  allow_negative_stock boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  last_change_hash char(64) CHECK (last_change_hash ~ '^[0-9a-f]{64}$'),
  last_change_id uuid,
  PRIMARY KEY (tenant_id, store_id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES pos_stores(tenant_id, id)
);

CREATE OR REPLACE FUNCTION initialize_store_inventory_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  INSERT INTO public.store_inventory_settings(tenant_id,store_id,allow_negative_stock)
  VALUES(NEW.tenant_id,NEW.id,false)
  ON CONFLICT (tenant_id,store_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION initialize_store_inventory_settings() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_initialize_store_inventory_settings ON pos_stores;
CREATE TRIGGER trg_initialize_store_inventory_settings
AFTER INSERT ON pos_stores
FOR EACH ROW EXECUTE FUNCTION initialize_store_inventory_settings();

-- Bootstrap one default store per tenant represented in any existing business table.
WITH tenant_ids AS (
  SELECT tenant_id FROM products
  UNION SELECT tenant_id FROM sales
  UNION SELECT tenant_id FROM terminal_devices
  UNION SELECT tenant_id FROM inventory_ledger
  UNION SELECT tenant_id FROM inventory_balances
  UNION SELECT tenant_id FROM terminal_sync_state
), missing AS (
  SELECT t.tenant_id
    FROM tenant_ids t
   WHERE NOT EXISTS (SELECT 1 FROM pos_stores s WHERE s.tenant_id=t.tenant_id)
)
INSERT INTO pos_stores(tenant_id,name,is_default)
SELECT tenant_id,'Default Store',true FROM missing
ON CONFLICT (tenant_id,name) DO NOTHING;

INSERT INTO store_inventory_settings(tenant_id,store_id,allow_negative_stock)
SELECT tenant_id,id,false FROM pos_stores
ON CONFLICT (tenant_id,store_id) DO NOTHING;

ALTER TABLE terminal_devices ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE terminal_sync_state ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE sale_lines ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE inventory_ledger ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE inventory_balances ADD COLUMN IF NOT EXISTS store_id uuid;

UPDATE terminal_devices d SET store_id=s.id
  FROM pos_stores s WHERE s.tenant_id=d.tenant_id AND s.is_default AND d.store_id IS NULL;
UPDATE terminal_sync_state t SET store_id=s.id
  FROM pos_stores s WHERE s.tenant_id=t.tenant_id AND s.is_default AND t.store_id IS NULL;
UPDATE sales x SET store_id=s.id
  FROM pos_stores s WHERE s.tenant_id=x.tenant_id AND s.is_default AND x.store_id IS NULL;
UPDATE sale_lines l SET store_id=s.id
  FROM pos_stores s WHERE s.tenant_id=l.tenant_id AND s.is_default AND l.store_id IS NULL;
UPDATE inventory_ledger l SET store_id=s.id
  FROM pos_stores s WHERE s.tenant_id=l.tenant_id AND s.is_default AND l.store_id IS NULL;
UPDATE inventory_balances b SET store_id=s.id
  FROM pos_stores s WHERE s.tenant_id=b.tenant_id AND s.is_default AND b.store_id IS NULL;

-- Do not silently bless historical negative stock or a pre-existing ledger/balance
-- mismatch with the new default-false Store policy. The whole migration rolls back.
DO $
BEGIN
  IF EXISTS (SELECT 1 FROM inventory_balances WHERE quantity < 0) THEN
    RAISE EXCEPTION 'STORE_MIGRATION_BLOCKED: legacy_negative_balance_requires_policy_review';
  END IF;
  IF EXISTS (
    WITH ledger AS (
      SELECT tenant_id,product_id,SUM(quantity_delta::bigint) AS ledger_qty
        FROM inventory_ledger GROUP BY tenant_id,product_id
    ), keys AS (
      SELECT tenant_id,product_id FROM ledger
      UNION SELECT tenant_id,product_id FROM inventory_balances
    )
    SELECT 1 FROM keys k
      LEFT JOIN ledger l USING (tenant_id,product_id)
      LEFT JOIN inventory_balances b USING (tenant_id,product_id)
     WHERE COALESCE(l.ledger_qty,0) <> COALESCE(b.quantity,0)
  ) THEN
    RAISE EXCEPTION 'STORE_MIGRATION_BLOCKED: legacy_ledger_balance_mismatch';
  END IF;
END $;

DO $
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['terminal_devices','terminal_sync_state','sales','sale_lines','inventory_ledger','inventory_balances'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN store_id SET NOT NULL',t);
  END LOOP;
END $$;

ALTER TABLE terminal_devices
  ADD CONSTRAINT terminal_devices_tenant_store_fk
  FOREIGN KEY (tenant_id,store_id) REFERENCES pos_stores(tenant_id,id);
ALTER TABLE terminal_sync_state
  ADD CONSTRAINT terminal_sync_state_tenant_store_fk
  FOREIGN KEY (tenant_id,store_id) REFERENCES pos_stores(tenant_id,id);
ALTER TABLE sales
  ADD CONSTRAINT sales_tenant_store_fk
  FOREIGN KEY (tenant_id,store_id) REFERENCES pos_stores(tenant_id,id);
ALTER TABLE sale_lines
  ADD CONSTRAINT sale_lines_tenant_store_fk
  FOREIGN KEY (tenant_id,store_id) REFERENCES pos_stores(tenant_id,id);
ALTER TABLE inventory_ledger
  ADD CONSTRAINT inventory_ledger_tenant_store_fk
  FOREIGN KEY (tenant_id,store_id) REFERENCES pos_stores(tenant_id,id);
ALTER TABLE inventory_balances
  ADD CONSTRAINT inventory_balances_tenant_store_fk
  FOREIGN KEY (tenant_id,store_id) REFERENCES pos_stores(tenant_id,id);
ALTER TABLE inventory_ledger
  ADD CONSTRAINT inventory_ledger_store_policy_fk
  FOREIGN KEY (tenant_id,store_id) REFERENCES store_inventory_settings(tenant_id,store_id);
ALTER TABLE inventory_balances
  ADD CONSTRAINT inventory_balances_store_policy_fk
  FOREIGN KEY (tenant_id,store_id) REFERENCES store_inventory_settings(tenant_id,store_id);

-- A sale line and its POS ledger rows must remain attached to the exact store
-- recorded on the parent sale, not merely to another store in the same tenant.
ALTER TABLE sales ADD CONSTRAINT sales_tenant_sale_store_uq
  UNIQUE (tenant_id,sale_id,store_id);
ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_parent_sale_store_fk
  FOREIGN KEY (tenant_id,sale_id,store_id)
  REFERENCES sales(tenant_id,sale_id,store_id);
ALTER TABLE inventory_ledger ADD CONSTRAINT inventory_ledger_parent_sale_store_fk
  FOREIGN KEY (tenant_id,sale_id,store_id)
  REFERENCES sales(tenant_id,sale_id,store_id);

-- Every historical sale line inherits the store recorded on its parent sale.
UPDATE sale_lines l SET store_id=s.store_id
  FROM sales s
 WHERE s.tenant_id=l.tenant_id AND s.sale_id=l.sale_id
   AND l.store_id IS DISTINCT FROM s.store_id;

ALTER TABLE inventory_balances DROP CONSTRAINT inventory_balances_pkey;
ALTER TABLE inventory_balances ADD CONSTRAINT inventory_balances_pkey
  PRIMARY KEY (tenant_id,store_id,product_id);

CREATE INDEX IF NOT EXISTS idx_inventory_ledger_store_product
  ON inventory_ledger(tenant_id,store_id,product_id,id);

-- The BEFORE INSERT trigger creates a zero balance row with conflict serialization,
-- then performs a conditional UPDATE. The row lock prevents concurrent oversell even
-- when the balance row is absent at statement start. If the ledger insert later fails,
-- PostgreSQL rolls both balance operations back with the ledger statement.
CREATE OR REPLACE FUNCTION apply_inventory_ledger_delta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  allow_negative boolean;
  resulting_quantity bigint;
BEGIN
  IF NEW.reason <> 'POS_SALE'
     AND session_user NOT IN ('prodx_inventory_admin','postgres') THEN
    RAISE EXCEPTION 'INVENTORY_ADMIN_ROLE_REQUIRED'
      USING ERRCODE='42501';
  END IF;

  SELECT cfg.allow_negative_stock
    INTO allow_negative
    FROM public.store_inventory_settings cfg
   WHERE cfg.tenant_id=NEW.tenant_id AND cfg.store_id=NEW.store_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STORE_INVENTORY_POLICY_MISSING'
      USING ERRCODE='23514';
  END IF;

  -- Ensure the key exists first. ON CONFLICT waits for any concurrent creator;
  -- the following UPDATE is a new READ COMMITTED command and sees its committed value.
  INSERT INTO public.inventory_balances(tenant_id,store_id,product_id,quantity,updated_at)
  VALUES(NEW.tenant_id,NEW.store_id,NEW.product_id,0,now())
  ON CONFLICT (tenant_id,store_id,product_id) DO NOTHING;

  UPDATE public.inventory_balances
     SET quantity=quantity+NEW.quantity_delta,updated_at=now()
   WHERE tenant_id=NEW.tenant_id
     AND store_id=NEW.store_id
     AND product_id=NEW.product_id
     AND (allow_negative OR NEW.quantity_delta >= 0 OR quantity+NEW.quantity_delta >= 0)
  RETURNING quantity INTO resulting_quantity;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK'
      USING ERRCODE='23514',
            DETAIL=format('tenant=%s store=%s product=%s delta=%s',
              NEW.tenant_id,NEW.store_id,NEW.product_id,NEW.quantity_delta);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION apply_inventory_ledger_delta() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_enforce_store_inventory_policy ON inventory_ledger;
DROP TRIGGER IF EXISTS trg_apply_inventory_ledger_delta ON inventory_ledger;
CREATE TRIGGER trg_apply_inventory_ledger_delta
BEFORE INSERT ON inventory_ledger
FOR EACH ROW EXECUTE FUNCTION apply_inventory_ledger_delta();

-- A POS sale cannot be inserted for a Store other than its enrolled terminal's
-- current Store, even if a caller bypasses the TypeScript checkout orchestration.
CREATE OR REPLACE FUNCTION enforce_sale_terminal_store()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.terminal_devices d
      JOIN public.pos_stores st ON st.tenant_id=d.tenant_id AND st.id=d.store_id
     WHERE d.tenant_id=NEW.tenant_id
       AND d.terminal_id=NEW.terminal_id
       AND d.store_id=NEW.store_id
       AND d.active=true AND d.revoked_at IS NULL
       AND d.not_before<=now() AND (d.not_after IS NULL OR d.not_after>now())
       AND st.active=true
  ) THEN
    RAISE EXCEPTION 'TERMINAL_STORE_MAPPING_MISMATCH'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION enforce_sale_terminal_store() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_enforce_sale_terminal_store ON sales;
CREATE TRIGGER trg_enforce_sale_terminal_store
BEFORE INSERT ON sales
FOR EACH ROW EXECUTE FUNCTION enforce_sale_terminal_store();

-- Store policy changes require an actor and payload hash and automatically append
-- an immutable audit event in the same transaction.
CREATE OR REPLACE FUNCTION require_store_inventory_policy_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.updated_by IS NULL OR NEW.last_change_hash IS NULL OR NEW.last_change_id IS NULL THEN
    RAISE EXCEPTION 'STORE_INVENTORY_POLICY_CHANGE_REQUIRES_AUDIT_CONTEXT'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION require_store_inventory_policy_audit() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_require_store_inventory_policy_audit ON store_inventory_settings;
CREATE TRIGGER trg_require_store_inventory_policy_audit
BEFORE UPDATE ON store_inventory_settings
FOR EACH ROW EXECUTE FUNCTION require_store_inventory_policy_audit();

CREATE OR REPLACE FUNCTION audit_store_inventory_policy_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  INSERT INTO public.audit_logs(
      tenant_id,actor_type,actor_id,action,entity_type,entity_id,
      payload_hash,catalog_version,metadata
    ) VALUES (
      NEW.tenant_id,'USER',NEW.updated_by,'STORE_INVENTORY_POLICY_UPDATED',
      'STORE_INVENTORY_SETTINGS',NEW.store_id,NEW.last_change_hash,NULL,
      jsonb_build_object(
        'store_id',NEW.store_id,
        'previous_allow_negative_stock',OLD.allow_negative_stock,
        'allow_negative_stock',NEW.allow_negative_stock,
        'change_id',NEW.last_change_id
      )
    );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION audit_store_inventory_policy_change() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_audit_store_inventory_policy_change ON store_inventory_settings;
CREATE TRIGGER trg_audit_store_inventory_policy_change
AFTER UPDATE ON store_inventory_settings
FOR EACH ROW EXECUTE FUNCTION audit_store_inventory_policy_change();

ALTER TABLE pos_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_stores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pos_stores;
CREATE POLICY tenant_isolation ON pos_stores
  USING (tenant_id=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid);

ALTER TABLE store_inventory_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_inventory_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON store_inventory_settings;
CREATE POLICY tenant_isolation ON store_inventory_settings
  USING (tenant_id=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid);

COMMIT;
),
  PRIMARY KEY (tenant_id, store_id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES pos_stores(tenant_id, id)
);

-- Bootstrap one default store per tenant represented in any existing business table.
WITH tenant_ids AS (
  SELECT tenant_id FROM products
  UNION SELECT tenant_id FROM sales
  UNION SELECT tenant_id FROM terminal_devices
  UNION SELECT tenant_id FROM inventory_ledger
  UNION SELECT tenant_id FROM inventory_balances
  UNION SELECT tenant_id FROM terminal_sync_state
), missing AS (
  SELECT t.tenant_id
    FROM tenant_ids t
   WHERE NOT EXISTS (SELECT 1 FROM pos_stores s WHERE s.tenant_id=t.tenant_id)
)
INSERT INTO pos_stores(tenant_id,name,is_default)
SELECT tenant_id,'Default Store',true FROM missing
ON CONFLICT (tenant_id,name) DO NOTHING;

INSERT INTO store_inventory_settings(tenant_id,store_id,allow_negative_stock)
SELECT tenant_id,id,false FROM pos_stores
ON CONFLICT (tenant_id,store_id) DO NOTHING;

ALTER TABLE terminal_devices ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE terminal_sync_state ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE sale_lines ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE inventory_ledger ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE inventory_balances ADD COLUMN IF NOT EXISTS store_id uuid;

UPDATE terminal_devices d SET store_id=s.id
  FROM pos_stores s WHERE s.tenant_id=d.tenant_id AND s.is_default AND d.store_id IS NULL;
UPDATE terminal_sync_state t SET store_id=s.id
  FROM pos_stores s WHERE s.tenant_id=t.tenant_id AND s.is_default AND t.store_id IS NULL;
UPDATE sales x SET store_id=s.id
  FROM pos_stores s WHERE s.tenant_id=x.tenant_id AND s.is_default AND x.store_id IS NULL;
UPDATE sale_lines l SET store_id=s.id
  FROM pos_stores s WHERE s.tenant_id=l.tenant_id AND s.is_default AND l.store_id IS NULL;
UPDATE inventory_ledger l SET store_id=s.id
  FROM pos_stores s WHERE s.tenant_id=l.tenant_id AND s.is_default AND l.store_id IS NULL;
UPDATE inventory_balances b SET store_id=s.id
  FROM pos_stores s WHERE s.tenant_id=b.tenant_id AND s.is_default AND b.store_id IS NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['terminal_devices','terminal_sync_state','sales','sale_lines','inventory_ledger','inventory_balances'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN store_id SET NOT NULL',t);
  END LOOP;
END $$;

ALTER TABLE terminal_devices
  ADD CONSTRAINT terminal_devices_tenant_store_fk
  FOREIGN KEY (tenant_id,store_id) REFERENCES pos_stores(tenant_id,id);
ALTER TABLE terminal_sync_state
  ADD CONSTRAINT terminal_sync_state_tenant_store_fk
  FOREIGN KEY (tenant_id,store_id) REFERENCES pos_stores(tenant_id,id);
ALTER TABLE sales
  ADD CONSTRAINT sales_tenant_store_fk
  FOREIGN KEY (tenant_id,store_id) REFERENCES pos_stores(tenant_id,id);
ALTER TABLE sale_lines
  ADD CONSTRAINT sale_lines_tenant_store_fk
  FOREIGN KEY (tenant_id,store_id) REFERENCES pos_stores(tenant_id,id);
ALTER TABLE inventory_ledger
  ADD CONSTRAINT inventory_ledger_tenant_store_fk
  FOREIGN KEY (tenant_id,store_id) REFERENCES pos_stores(tenant_id,id);
ALTER TABLE inventory_balances
  ADD CONSTRAINT inventory_balances_tenant_store_fk
  FOREIGN KEY (tenant_id,store_id) REFERENCES pos_stores(tenant_id,id);

-- A sale line and its POS ledger rows must remain attached to the exact store
-- recorded on the parent sale, not merely to another store in the same tenant.
ALTER TABLE sales ADD CONSTRAINT sales_tenant_sale_store_uq
  UNIQUE (tenant_id,sale_id,store_id);
ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_parent_sale_store_fk
  FOREIGN KEY (tenant_id,sale_id,store_id)
  REFERENCES sales(tenant_id,sale_id,store_id);
ALTER TABLE inventory_ledger ADD CONSTRAINT inventory_ledger_parent_sale_store_fk
  FOREIGN KEY (tenant_id,sale_id,store_id)
  REFERENCES sales(tenant_id,sale_id,store_id);

-- Every historical sale line inherits the store recorded on its parent sale.
UPDATE sale_lines l SET store_id=s.store_id
  FROM sales s
 WHERE s.tenant_id=l.tenant_id AND s.sale_id=l.sale_id
   AND l.store_id IS DISTINCT FROM s.store_id;

ALTER TABLE inventory_balances DROP CONSTRAINT inventory_balances_pkey;
ALTER TABLE inventory_balances ADD CONSTRAINT inventory_balances_pkey
  PRIMARY KEY (tenant_id,store_id,product_id);

-- The BEFORE INSERT trigger applies the balance delta with one atomic UPSERT.
-- The conflict row lock and conditional UPDATE prevent concurrent oversell even
-- when the balance row is absent at statement start. If the ledger insert later
-- fails, PostgreSQL rolls the balance change back with the same statement.
CREATE OR REPLACE FUNCTION apply_inventory_ledger_delta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  allow_negative boolean;
  resulting_quantity bigint;
BEGIN
  SELECT cfg.allow_negative_stock
    INTO allow_negative
    FROM public.store_inventory_settings cfg
   WHERE cfg.tenant_id=NEW.tenant_id AND cfg.store_id=NEW.store_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STORE_INVENTORY_POLICY_MISSING'
      USING ERRCODE='23514';
  END IF;

  INSERT INTO public.inventory_balances(tenant_id,store_id,product_id,quantity,updated_at)
  SELECT NEW.tenant_id,NEW.store_id,NEW.product_id,NEW.quantity_delta,now()
   WHERE allow_negative OR NEW.quantity_delta >= 0
  ON CONFLICT (tenant_id,store_id,product_id)
  DO UPDATE SET quantity=public.inventory_balances.quantity+EXCLUDED.quantity,
                updated_at=now()
    WHERE allow_negative
       OR NEW.quantity_delta >= 0
       OR public.inventory_balances.quantity + EXCLUDED.quantity >= 0
  RETURNING quantity INTO resulting_quantity;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK'
      USING ERRCODE='23514',
            DETAIL=format('tenant=%s store=%s product=%s delta=%s',
              NEW.tenant_id,NEW.store_id,NEW.product_id,NEW.quantity_delta);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION apply_inventory_ledger_delta() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_enforce_store_inventory_policy ON inventory_ledger;
DROP TRIGGER IF EXISTS trg_apply_inventory_ledger_delta ON inventory_ledger;
CREATE TRIGGER trg_apply_inventory_ledger_delta
BEFORE INSERT ON inventory_ledger
FOR EACH ROW EXECUTE FUNCTION apply_inventory_ledger_delta();

ALTER TABLE pos_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_stores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pos_stores;
CREATE POLICY tenant_isolation ON pos_stores
  USING (tenant_id=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid);

ALTER TABLE store_inventory_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_inventory_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON store_inventory_settings;
CREATE POLICY tenant_isolation ON store_inventory_settings
  USING (tenant_id=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid);

COMMIT;
