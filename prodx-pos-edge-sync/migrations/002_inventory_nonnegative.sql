-- PRODX POS inventory non-negative invariant.
-- Apply after 001_pos_ledger.sql. Product-row locking serializes ledger deltas
-- even when no inventory_balances row exists yet (opening stock / first sale).
CREATE OR REPLACE FUNCTION apply_inventory_ledger_delta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  current_balance bigint;
BEGIN
  PERFORM 1
    FROM public.products
   WHERE tenant_id=NEW.tenant_id AND id=NEW.product_id
   FOR NO KEY UPDATE;
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
$$;
REVOKE ALL ON FUNCTION apply_inventory_ledger_delta() FROM PUBLIC;
