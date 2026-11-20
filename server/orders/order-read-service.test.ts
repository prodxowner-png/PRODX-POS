import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResultRow } from 'pg';
import type { SqlQueryExecutor } from '../db/transaction';
import { createOrderReadService } from './order-read-service';

const orderId = '00000000-0000-4000-8000-000000001010';
const itemId = '00000000-0000-4000-8000-000000001011';

test('order read service exposes immutable partial refund totals and restocked item quantities', async () => {
  const queries: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const query = async <T extends QueryResultRow>(sql: string, parameters: readonly unknown[] = []) => {
    queries.push({ sql, parameters });
    if (sql.includes('FROM prodx_orders')) return { rows: [{
      id: orderId, order_number: 'ORD-1', idempotency_key: 'idem-1', store_id: 'store-1',
      register_id: 'register-1', cashier_id: 'user-1', cashier_name: 'Cashier', status: 'server_confirmed',
      gross_subtotal_amount: '100.00', item_discounts_amount: '0.00', order_discount_amount: '0.00',
      net_subtotal_amount: '93.46', total_tax_amount: '6.54', grand_total_amount: '100.00', currency: 'THB',
      total_items_count: 2, created_at: '2026-11-20T10:00:00.000Z', server_committed_at: '2026-11-20T10:00:01.000Z',
    }] as unknown as T[] };
    if (sql.includes('FROM prodx_order_items')) return { rows: [{
      id: itemId, order_id: orderId, product_id: '00000000-0000-4000-8000-000000001008', store_id: 'store-1',
      sku: 'SKU-1', barcode: '123', name: 'Coffee', category_id: 'cat-1', product_price_amount: '50.00',
      cost_price_amount: '25.00', tax_rate_bps: 700, current_stock: 8, reorder_point: 2, unit_of_measure: 'cup',
      quantity: 2, unit_price_amount: '50.00', item_discount_bps: 0, line_subtotal_amount: '93.46',
      line_tax_amount: '6.54', line_total_amount: '100.00', currency: 'THB',
    }] as unknown as T[] };
    if (sql.includes('FROM prodx_payments')) return { rows: [] as unknown as T[] };
    if (sql.includes('FROM prodx_refund_items')) return { rows: [{ order_item_id: itemId, restocked_quantity: 1 }] as unknown as T[] };
    if (sql.includes('FROM prodx_refunds')) return { rows: [{ order_id: orderId, refunded_amount: '25.00' }] as unknown as T[] };
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const db: SqlQueryExecutor = { query };
  const orders = await createOrderReadService(db).getOrders('org-1', 'store-1', 200);

  assert.equal(orders.length, 1);
  assert.equal(orders[0].refundedAmount?.amountInCents, 2500);
  assert.equal(orders[0].items[0].restockedQuantity, 1);
  assert.equal(orders[0].items[0].quantity - (orders[0].items[0].restockedQuantity ?? 0), 1);
  const paymentQuery = queries.find((item) => item.sql.includes('FROM prodx_payments'));
  assert.ok(paymentQuery?.sql.includes("status IN ('captured', 'settled')"));
  for (const entry of queries.filter((item) => item.sql.includes('FROM prodx_refunds'))) {
    assert.deepEqual(entry.parameters, ['org-1', 'store-1', [orderId]]);
  }
});
