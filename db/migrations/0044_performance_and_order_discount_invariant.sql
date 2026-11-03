-- Correct order-discount accounting in the deferred financial invariant.
-- Checkout line_total_amount stores the item amount after item-level discounts,
-- before the order-level discount. Therefore the sum of line totals minus the
-- order-level discount must equal the persisted grand total.
CREATE OR REPLACE FUNCTION prodx_validate_order_financial_invariants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_order_id UUID;
  v_order prodx_orders%ROWTYPE;
  v_item_total NUMERIC(12,2);
  v_payment_total NUMERIC(12,2);
  v_item_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'prodx_orders' THEN
    v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  END IF;

  SELECT * INTO v_order FROM prodx_orders WHERE id = v_order_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(line_total_amount), 0), COALESCE(SUM(quantity), 0)
    INTO v_item_total, v_item_count
    FROM prodx_order_items
   WHERE order_id = v_order_id;

  IF v_item_count <> v_order.total_items_count
     OR v_item_total - v_order.order_discount_amount <> v_order.grand_total_amount THEN
    RAISE EXCEPTION 'order financial invariant violated for %', v_order_id
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_payment_total
    FROM prodx_payments
   WHERE order_id = v_order_id;

  IF v_payment_total <> v_order.grand_total_amount THEN
    RAISE EXCEPTION 'order payment invariant violated for %', v_order_id
      USING ERRCODE = '23514';
  END IF;

  IF v_order.net_subtotal_amount + v_order.total_tax_amount <> v_order.grand_total_amount THEN
    RAISE EXCEPTION 'order tax/subtotal invariant violated for %', v_order_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

INSERT INTO prodx_schema_migrations(version)
VALUES ('0044_performance_and_order_discount_invariant')
ON CONFLICT (version) DO NOTHING;
