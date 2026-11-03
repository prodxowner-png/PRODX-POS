import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresPool, resolveConfiguredDatabaseUrl } from '../db/postgres';
import { createTransactionalPostgresExecutor } from '../db/transaction';
import { createCheckoutService } from './checkout-service';
import { createRefundService } from './refund-service';
import type { CheckoutRequest } from '../../src/adapters/types';

const url = resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);
const pool = url ? createPostgresPool({ connectionString: url, max: 8 }) : null;
const db = pool ? createTransactionalPostgresExecutor(pool) : null;

const id = {
  org: '00000000-0000-4000-8000-000000002001',
  store: '00000000-0000-4000-8000-000000002002',
  user: '00000000-0000-4000-8000-000000002004',
  reg: '00000000-0000-4000-8000-000000002005',
  shift: '00000000-0000-4000-8000-000000002006',
  cat: '00000000-0000-4000-8000-000000002007',
  product: '00000000-0000-4000-8000-000000002008',
  payment: '00000000-0000-4000-8000-000000002009',
};

const request = (key: string): CheckoutRequest => ({
  idempotencyKey: key,
  storeId: id.store,
  registerId: id.reg,
  cashierId: id.user,
  items: [{
    lineId: 'refund-line',
    product: {
      id: id.product, storeId: id.store, sku: 'RF-1', barcode: 'RF-1', name: 'Refund Product',
      categoryId: id.cat, price: { amountInCents: 1000, currency: 'THB' },
      costPrice: { amountInCents: 500, currency: 'THB' }, taxRateBps: 0, currentStock: 10,
      reorderPoint: 1, unitOfMeasure: 'each',
    },
    quantity: 2, unitPrice: { amountInCents: 1000, currency: 'THB' }, discountBps: 0,
    lineSubtotal: { amountInCents: 2000, currency: 'THB' }, lineTax: { amountInCents: 0, currency: 'THB' },
    lineTotal: { amountInCents: 2000, currency: 'THB' },
  }],
  totals: {
    grossSubtotal: { amountInCents: 2000, currency: 'THB' }, itemDiscounts: { amountInCents: 0, currency: 'THB' },
    orderDiscount: { amountInCents: 0, currency: 'THB' }, netSubtotal: { amountInCents: 2000, currency: 'THB' },
    totalTax: { amountInCents: 0, currency: 'THB' }, grandTotal: { amountInCents: 2000, currency: 'THB' },
    totalItemsCount: 2,
  },
  payments: [{
    id: id.payment, method: 'cash', amount: { amountInCents: 2000, currency: 'THB' },
    tenderedCash: { amountInCents: 2000, currency: 'THB' }, changeGiven: { amountInCents: 0, currency: 'THB' },
    timestamp: '2026-09-18T00:00:00.000Z',
  }],
});

async function clean() {
  if (!pool) return;
  await pool.query('ALTER TABLE prodx_audit_log DISABLE TRIGGER prodx_audit_log_immutable_guard');
  await pool.query('ALTER TABLE prodx_refunds DISABLE TRIGGER prodx_refund_immutable_guard');
  await pool.query('ALTER TABLE prodx_refund_items DISABLE TRIGGER prodx_refund_item_immutable_guard');
  try {
    for (const [sql, params] of [
      ['DELETE FROM prodx_refund_items WHERE store_id=$1', [id.store]],
      ['DELETE FROM prodx_cash_movements WHERE refund_id IN (SELECT id FROM prodx_refunds WHERE store_id=$1)', [id.store]],
      ['DELETE FROM prodx_refunds WHERE store_id=$1', [id.store]],
      ['DELETE FROM prodx_cash_movements WHERE shift_id=$1', [id.shift]],
      ['DELETE FROM prodx_audit_log WHERE store_id=$1', [id.store]],
      ['DELETE FROM prodx_payments WHERE store_id=$1', [id.store]],
      ['DELETE FROM prodx_order_items WHERE store_id=$1', [id.store]],
      ['DELETE FROM prodx_inventory_ledger WHERE store_id=$1', [id.store]],
      ['DELETE FROM prodx_orders WHERE store_id=$1', [id.store]],
      ['DELETE FROM prodx_shifts WHERE id=$1', [id.shift]],
      ['DELETE FROM prodx_products WHERE id=$1', [id.product]],
      ['DELETE FROM prodx_categories WHERE id=$1', [id.cat]],
      ['DELETE FROM prodx_registers WHERE id=$1', [id.reg]],
      ['DELETE FROM prodx_store_memberships WHERE store_id=$1', [id.store]],
      ['DELETE FROM prodx_users WHERE id=$1', [id.user]],
      ['DELETE FROM prodx_stores WHERE id=$1', [id.store]],
      ['DELETE FROM prodx_organizations WHERE id=$1', [id.org]],
    ] as const) await pool.query(sql, [...params]);
  } finally {
    await pool.query('ALTER TABLE prodx_audit_log ENABLE TRIGGER prodx_audit_log_immutable_guard');
    await pool.query('ALTER TABLE prodx_refunds ENABLE TRIGGER prodx_refund_immutable_guard');
    await pool.query('ALTER TABLE prodx_refund_items ENABLE TRIGGER prodx_refund_item_immutable_guard');
  }
}

async function seed() {
  if (!pool) throw new Error('DATABASE_URL required');
  await clean();
  await pool.query('INSERT INTO prodx_organizations(id,code,name) VALUES($1,$2,$3)', [id.org, 'rf-core', 'Refund Core']);
  await pool.query("INSERT INTO prodx_stores(id,organization_id,code,name,business_timezone) VALUES($1,$2,'rf-1','Refund Store','Asia/Bangkok')", [id.store, id.org]);
  await pool.query('INSERT INTO prodx_users(id,organization_id,username,display_name) VALUES($1,$2,$3,$4)', [id.user, id.org, 'rf-user', 'Refund User']);
  await pool.query('INSERT INTO prodx_store_memberships(organization_id,store_id,user_id) VALUES($1,$2,$3)', [id.org, id.store, id.user]);
  await pool.query('INSERT INTO prodx_registers(id,organization_id,store_id,code,name) VALUES($1,$2,$3,$4,$5)', [id.reg, id.org, id.store, 'R1', 'Register']);
  await pool.query("INSERT INTO prodx_shifts(id,organization_id,store_id,register_id,cashier_id,opening_float_amount,currency) VALUES($1,$2,$3,$4,$5,0,'THB')", [id.shift, id.org, id.store, id.reg, id.user]);
  await pool.query('INSERT INTO prodx_categories(id,organization_id,store_id,name,slug) VALUES($1,$2,$3,$4,$5)', [id.cat, id.org, id.store, 'Category', 'refund-category']);
  await pool.query("INSERT INTO prodx_products(id,organization_id,store_id,category_id,sku,barcode,name,price_amount,cost_price_amount,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure) VALUES($1,$2,$3,$4,'RF-1','RF-1','Refund Product',10,5,'THB',0,10,1,'each')", [id.product, id.org, id.store, id.cat]);
}

test('PostgreSQL refund is atomic, idempotent, bounded by order total, and restores stock', async (t) => {
  if (!pool || !db) { t.skip('DATABASE_URL not configured'); return; }
  await seed();
  t.after(async () => { await clean(); await pool.end(); });

  const order = await createCheckoutService(db).checkout(request('refund-order'));
  const refund = createRefundService(db);

  await pool.query('DELETE FROM prodx_payments WHERE store_id=$1 AND order_id=$2', [id.store, order.order.id]);
  await assert.rejects(refund.refund({
    storeId: id.store, orderId: order.order.id,
    refundAmount: { amountInCents: 1000, currency: 'THB' },
    reason: 'Uncaptured payment', refundMethod: 'cash', authorizedByUserId: id.user,
    idempotencyKey: 'refund-uncaptured',
  }));
  await pool.query(
    "INSERT INTO prodx_payments (id,organization_id,store_id,order_id,method,amount,tendered_cash,change_given,currency) VALUES($1,$2,$3,$4,'cash',20,20,0,'THB')",
    [id.payment, id.org, id.store, order.order.id],
  );

  // Pending payment rows do not count toward a captured refundable balance.
  await pool.query('UPDATE prodx_payments SET status=$1 WHERE id=$2', ['pending', id.payment]);
  await assert.rejects(refund.refund({
    storeId: id.store, orderId: order.order.id,
    refundAmount: { amountInCents: 1000, currency: 'THB' },
    reason: 'Pending payment', refundMethod: 'cash', authorizedByUserId: id.user,
    idempotencyKey: 'refund-pending-payment',
  }));
  await pool.query('UPDATE prodx_payments SET status=$1 WHERE id=$2', ['captured', id.payment]);

  // The database must reject a payment currency mutation before it can corrupt refund eligibility.
  await assert.rejects(pool.query('UPDATE prodx_payments SET currency=$1 WHERE id=$2', ['USD', id.payment]));

  const first = await refund.refund({
    storeId: id.store, orderId: order.order.id,
    refundAmount: { amountInCents: 1000, currency: 'THB' },
    reason: 'Customer return', refundMethod: 'cash', authorizedByUserId: id.user,
    itemsToRestock: [{ productId: id.product, quantity: 1 }], idempotencyKey: 'refund-1',
  });

  assert.equal(first.status, 'server_confirmed');
  assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.product])).rows[0].current_stock, 9);
  assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_cash_movements WHERE shift_id=$1 AND type=\'cash_refund\'', [id.shift])).rows[0].n, 1);
  assert.equal((await pool.query('SELECT amount::text FROM prodx_refund_items WHERE store_id=$1 AND refund_id=$2', [id.store, first.refundId])).rows[0].amount, '10.00');

  // A refund cannot be authorized by a user whose target-store membership is inactive.
  await pool.query('UPDATE prodx_store_memberships SET active=false WHERE organization_id=$1 AND store_id=$2 AND user_id=$3', [id.org, id.store, id.user]);
  await assert.rejects(refund.refund({
    storeId: id.store, orderId: order.order.id,
    refundAmount: { amountInCents: 100, currency: 'THB' },
    reason: 'Inactive member', refundMethod: 'cash', authorizedByUserId: id.user,
    idempotencyKey: 'refund-inactive-member',
  }));
  await pool.query('UPDATE prodx_store_memberships SET active=true WHERE organization_id=$1 AND store_id=$2 AND user_id=$3', [id.org, id.store, id.user]);

  await assert.rejects(pool.query('UPDATE prodx_refund_items SET amount=0 WHERE refund_id=$1', [first.refundId]));
  await assert.rejects(pool.query('DELETE FROM prodx_refund_items WHERE refund_id=$1', [first.refundId]));

  const stockBeforeRejectedRestock = (await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.product])).rows[0].current_stock;
  await assert.rejects(refund.refund({
    storeId: id.store, orderId: order.order.id,
    refundAmount: { amountInCents: 1, currency: 'THB' },
    reason: 'Mismatched restock value', refundMethod: 'cash', authorizedByUserId: id.user,
    itemsToRestock: [{ productId: id.product, quantity: 1 }], idempotencyKey: 'refund-mismatch',
  }));
  assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.product])).rows[0].current_stock, stockBeforeRejectedRestock);

  const cached = await refund.refund({
    storeId: id.store, orderId: order.order.id,
    refundAmount: { amountInCents: 1000, currency: 'THB' },
    reason: 'Customer return', refundMethod: 'cash', authorizedByUserId: id.user,
    itemsToRestock: [{ productId: id.product, quantity: 1 }], idempotencyKey: 'refund-1',
  });
  assert.equal(cached.idempotencyCached, true);

  const concurrentResults = await Promise.all([
    refund.refund({ storeId: id.store, orderId: order.order.id, refundAmount: { amountInCents: 500, currency: 'THB' }, reason: 'Concurrent refund', refundMethod: 'cash', authorizedByUserId: id.user, idempotencyKey: 'refund-concurrent' }),
    refund.refund({ storeId: id.store, orderId: order.order.id, refundAmount: { amountInCents: 500, currency: 'THB' }, reason: 'Concurrent refund', refundMethod: 'cash', authorizedByUserId: id.user, idempotencyKey: 'refund-concurrent' }),
  ]);
  assert.equal(new Set(concurrentResults.map((result) => result.refundId)).size, 1);
  assert.equal(concurrentResults.filter((result) => result.idempotencyCached).length, 1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_refunds WHERE store_id=$1 AND order_id=$2', [id.store, order.order.id])).rows[0].n, 2);

  const finalRefund = await refund.refund({ storeId: id.store, orderId: order.order.id, refundAmount: { amountInCents: 500, currency: 'THB' }, reason: 'Final refund', refundMethod: 'cash', authorizedByUserId: id.user, idempotencyKey: 'refund-final' });
  assert.equal(finalRefund.status, 'refunded');
  const finalCached = await refund.refund({ storeId: id.store, orderId: order.order.id, refundAmount: { amountInCents: 500, currency: 'THB' }, reason: 'Final refund', refundMethod: 'cash', authorizedByUserId: id.user, idempotencyKey: 'refund-final' });
  assert.equal(finalCached.idempotencyCached, true);
  assert.equal(finalCached.status, 'refunded');

  await assert.rejects(refund.refund({ storeId: id.store, orderId: order.order.id, refundAmount: { amountInCents: 500, currency: 'THB' }, reason: 'Different request reusing the same key', refundMethod: 'cash', authorizedByUserId: id.user, idempotencyKey: 'refund-1' }));
  await assert.rejects(refund.refund({ storeId: id.store, orderId: order.order.id, refundAmount: { amountInCents: 1000, currency: 'THB' }, reason: 'Customer return', refundMethod: 'cash', authorizedByUserId: id.user, itemsToRestock: [{ productId: id.product, quantity: 2 }], idempotencyKey: 'refund-1' }));
  await assert.rejects(refund.refund({ storeId: id.store, orderId: order.order.id, refundAmount: { amountInCents: 1100, currency: 'THB' }, reason: 'Too much', refundMethod: 'cash', authorizedByUserId: id.user, idempotencyKey: 'refund-too-much' }));
});