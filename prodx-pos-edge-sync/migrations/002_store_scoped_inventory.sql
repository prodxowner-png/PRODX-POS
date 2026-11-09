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

CREATE OR REPLACE FUNCTION enforce_store_inventory_policy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  current_quantity bigint;
  allow_negative boolean;
BEGIN
  -- Serialize all ledger writers for the same tenant/store/product, including the
  -- first write when no balance row exists yet.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.tenant_id::text || ':' || NEW.store_id::text || ':' || NEW.product_id::text, 0
  ));

  SELECT COALESCE(cfg.allow_negative_stock,false)
    INTO allow_negative
    FROM public.store_inventory_settings cfg
   WHERE cfg.tenant_id=NEW.tenant_id AND cfg.store_id=NEW.store_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STORE_INVENTORY_POLICY_MISSING'
      USING ERRCODE='23514';
  END IF;

  SELECT b.quantity INTO current_quantity
    FROM public.inventory_balances b
   WHERE b.tenant_id=NEW.tenant_id
     AND b.store_id=NEW.store_id
     AND b.product_id=NEW.product_id
   FOR UPDATE;
  current_quantity := COALESCE(current_quantity,0);

  IF NOT allow_negative AND NEW.quantity_delta < 0 AND current_quantity + NEW.quantity_delta < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK'
      USING ERRCODE='23514',
            DETAIL=format('tenant=%s store=%s product=%s available=%s delta=%s',
              NEW.tenant_id,NEW.store_id,NEW.product_id,current_quantity,NEW.quantity_delta);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION enforce_store_inventory_policy() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_enforce_store_inventory_policy ON inventory_ledger;
CREATE TRIGGER trg_enforce_store_inventory_policy
BEFORE INSERT ON inventory_ledger
FOR EACH ROW EXECUTE FUNCTION enforce_store_inventory_policy();

CREATE OR REPLACE FUNCTION apply_inventory_ledger_delta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  INSERT INTO public.inventory_balances(tenant_id,store_id,product_id,quantity,updated_at)
  VALUES(NEW.tenant_id,NEW.store_id,NEW.product_id,NEW.quantity_delta,now())
  ON CONFLICT (tenant_id,store_id,product_id)
  DO UPDATE SET quantity=public.inventory_balances.quantity+EXCLUDED.quantity,
                updated_at=now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION apply_inventory_ledger_delta() FROM PUBLIC;

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
