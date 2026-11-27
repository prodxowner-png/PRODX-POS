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


-- Keep the database refund allocation guard in lockstep with the server-side
-- order-discount allocation. Order-item line totals are stored before the
-- order-level discount, so refund/restock values must use the discounted line
-- value rather than the original line_total_amount.
CREATE OR REPLACE FUNCTION prodx_enforce_refund_item_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  ordered_quantity INTEGER;
  previous_quantity INTEGER;
  cumulative_quantity INTEGER;
  line_total_cents BIGINT;
  order_subtotal_cents BIGINT;
  order_discount_cents BIGINT;
  grand_total_cents BIGINT;
  base_discount_cents BIGINT;
  remaining_discount_cents BIGINT;
  current_remainder NUMERIC;
  higher_remainder_count BIGINT;
  line_discount_cents BIGINT;
  adjusted_line_total_cents BIGINT;
  expected_amount NUMERIC(12,2);
  refund_amount NUMERIC(12,2);
  previous_refund_item_amount NUMERIC(12,2);
BEGIN
  SELECT quantity, ROUND(line_total_amount * 100)::BIGINT
    INTO ordered_quantity, line_total_cents
    FROM prodx_order_items
   WHERE id = NEW.order_item_id
     AND store_id = NEW.store_id
     AND order_id = NEW.order_id
   FOR UPDATE;

  IF ordered_quantity IS NULL THEN
    RAISE EXCEPTION 'Refund item order line was not found' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(ROUND(line_total_amount * 100)::BIGINT), 0)::BIGINT
    INTO order_subtotal_cents
    FROM prodx_order_items
   WHERE store_id = NEW.store_id AND order_id = NEW.order_id;

  SELECT ROUND(order_discount_amount * 100)::BIGINT,
         ROUND(grand_total_amount * 100)::BIGINT
    INTO order_discount_cents, grand_total_cents
    FROM prodx_orders
   WHERE id = NEW.order_id AND store_id = NEW.store_id;

  IF order_discount_cents IS NULL OR order_discount_cents > order_subtotal_cents
     OR order_subtotal_cents - order_discount_cents <> grand_total_cents THEN
    RAISE EXCEPTION 'Order line values, order discount, and grand total are inconsistent' USING ERRCODE = '23514';
  END IF;

  IF order_subtotal_cents = 0 THEN
    adjusted_line_total_cents := 0;
  ELSE
    -- Largest-remainder allocation distributes every discount cent across
    -- order lines. UUID order deterministically breaks equal-remainder ties.
    SELECT COALESCE(SUM(TRUNC(
      order_discount_cents::NUMERIC * ROUND(line_total_amount * 100)::NUMERIC
      / order_subtotal_cents::NUMERIC
    )), 0)::BIGINT
      INTO base_discount_cents
      FROM prodx_order_items
     WHERE store_id = NEW.store_id AND order_id = NEW.order_id;

    remaining_discount_cents := order_discount_cents - base_discount_cents;
    line_discount_cents := TRUNC(
      order_discount_cents::NUMERIC * line_total_cents::NUMERIC
      / order_subtotal_cents::NUMERIC
    )::BIGINT;
    current_remainder := MOD(
      order_discount_cents::NUMERIC * line_total_cents::NUMERIC,
      order_subtotal_cents::NUMERIC
    );

    SELECT COUNT(*)::BIGINT
      INTO higher_remainder_count
      FROM (
        SELECT id,
          MOD(
            order_discount_cents::NUMERIC * ROUND(line_total_amount * 100)::NUMERIC,
            order_subtotal_cents::NUMERIC
          ) AS remainder
          FROM prodx_order_items
         WHERE store_id = NEW.store_id AND order_id = NEW.order_id
      ) AS line_shares
     WHERE remainder > current_remainder
        OR (remainder = current_remainder AND id < NEW.order_item_id);

    IF higher_remainder_count < remaining_discount_cents THEN
      line_discount_cents := line_discount_cents + 1;
    END IF;

    adjusted_line_total_cents := line_total_cents - line_discount_cents;
  END IF;

  SELECT COALESCE(SUM(quantity), 0)::INTEGER
    INTO previous_quantity
    FROM prodx_refund_items
   WHERE store_id = NEW.store_id
     AND order_id = NEW.order_id
     AND order_item_id = NEW.order_item_id;

  cumulative_quantity := previous_quantity + NEW.quantity;
  IF cumulative_quantity > ordered_quantity THEN
    RAISE EXCEPTION 'Refund item quantity exceeds the ordered quantity' USING ERRCODE = '23514';
  END IF;

  -- Match the server's cumulative half-up allocation for partial returns.
  expected_amount := (
    ROUND(adjusted_line_total_cents::NUMERIC * cumulative_quantity / ordered_quantity)
    - ROUND(adjusted_line_total_cents::NUMERIC * previous_quantity / ordered_quantity)
  ) / 100;

  IF NEW.amount <> expected_amount THEN
    RAISE EXCEPTION 'Refund item amount does not match the authoritative discount-adjusted order-line allocation' USING ERRCODE = '23514';
  END IF;

  SELECT amount INTO refund_amount
    FROM prodx_refunds
   WHERE id = NEW.refund_id AND store_id = NEW.store_id;
  SELECT COALESCE(SUM(amount), 0)
    INTO previous_refund_item_amount
    FROM prodx_refund_items
   WHERE refund_id = NEW.refund_id AND store_id = NEW.store_id;
  IF previous_refund_item_amount + NEW.amount > refund_amount THEN
    RAISE EXCEPTION 'Refund item allocations exceed the parent refund amount' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

INSERT INTO prodx_schema_migrations(version)
VALUES ('0051_performance_and_order_discount_invariant')
ON CONFLICT (version) DO NOTHING;
