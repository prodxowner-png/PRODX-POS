import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { CheckoutRequest } from '../../src/adapters/types';
import { createPostgresPool } from '../db/postgres';
import { assertDisposableTestDatabaseUrl } from '../db/test-database-guard';
import { createTransactionalPostgresExecutor } from '../db/transaction';
import { createCheckoutService } from './checkout-service';
import { createPaymentLifecycleService, PaymentLifecycleError } from './payment-lifecycle';

const configuredUrl = process.env.DATABASE_URL?.trim();
const url = configuredUrl
  ? assertDisposableTestDatabaseUrl(configuredUrl, 'Payment lifecycle PostgreSQL integration test')
  : undefined;
const pool = url ? createPostgresPool({ connectionString: url, max: 8 }) : null;
const db = pool ? createTransactionalPostgresExecutor(pool) : null;

// Unique fixtures keep financial and append-only audit history intact after each run.
const id = {
  org: randomUUID(), store: randomUUID(), foreignOrg: randomUUID(), foreignStore: randomUUID(),
  user: randomUUID(), register: randomUUID(), shift: randomUUID(), category: randomUUID(),
  product: randomUUID(), payment: randomUUID(),
};
const suffix = id.org.replaceAll('-', '').slice(0, 12);

const checkoutRequest = (key: string): CheckoutRequest => ({
  idempotencyKey: key,
  storeId: id.store,
  registerId: id.register,
  cashierId: id.user,
  items: [{
    lineId: 'payment-lifecycle-line',
    product: {
      id: id.product, storeId: id.store, sku: `PAY-${suffix}`, barcode: `PAY-${suffix}`,
      name: 'Payment lifecycle fixture', categoryId: id.category,
      price: { amountInCents: 1250, currency: 'THB' },
      costPrice: { amountInCents: 500, currency: 'THB' }, taxRateBps: 0,
      currentStock: 10, reorderPoint: 1, unitOfMeasure: 'each',
    },
    quantity: 1,
    unitPrice: { amountInCents: 1250, currency: 'THB' },
    discountBps: 0,
    lineSubtotal: { amountInCents: 1250, currency: 'THB' },
    lineTax: { amountInCents: 0, currency: 'THB' },
    lineTotal: { amountInCents: 1250, currency: 'THB' },
  }],
  totals: {
    grossSubtotal: { amountInCents: 1250, currency: 'THB' },
    itemDiscounts: { amountInCents: 0, currency: 'THB' },
    orderDiscount: { amountInCents: 0, currency: 'THB' },
    netSubtotal: { amountInCents: 1250, currency: 'THB' },
    totalTax: { amountInCents: 0, currency: 'THB' },
    grandTotal: { amountInCents: 1250, currency: 'THB' },
    totalItemsCount: 1,
  },
  payments: [{
    id: id.payment, method: 'card', amount: { amountInCents: 1250, currency: 'THB' },
    timestamp: '2026-11-23T00:00:00.000Z',
  }],
});

async function seed() {
  if (!pool) throw new Error('DATABASE_URL required');
  await pool.query('INSERT INTO prodx_organizations(id,code,name) VALUES($1,$2,$3),($4,$5,$6)', [
    id.org, `pay-org-${suffix}`, 'Payment lifecycle test org',
    id.foreignOrg, `pay-foreign-org-${suffix}`, 'Foreign payment lifecycle test org',
  ]);
  await pool.query(
    'INSERT INTO prodx_stores(id,organization_id,code,name,business_timezone) VALUES($1,$2,$3,$4,$5),($6,$7,$8,$9,$5)',
    [id.store, id.org, `pay-store-${suffix}`, 'Payment lifecycle store', 'Asia/Bangkok',
      id.foreignStore, id.foreignOrg, `pay-foreign-store-${suffix}`, 'Foreign payment lifecycle store'],
  );
  await pool.query('INSERT INTO prodx_users(id,organization_id,username,display_name) VALUES($1,$2,$3,$4)', [
    id.user, id.org, `pay-user-${suffix}`, 'Payment lifecycle user',
  ]);
  await pool.query('INSERT INTO prodx_store_memberships(organization_id,store_id,user_id) VALUES($1,$2,$3)', [id.org, id.store, id.user]);
  await pool.query('INSERT INTO prodx_registers(id,organization_id,store_id,code,name) VALUES($1,$2,$3,$4,$5)', [
    id.register, id.org, id.store, `PAY-R-${suffix}`, 'Payment lifecycle register',
  ]);
  await pool.query(
    "INSERT INTO prodx_shifts(id,organization_id,store_id,register_id,cashier_id,opening_float_amount,currency) VALUES($1,$2,$3,$4,$5,0,'THB')",
    [id.shift, id.org, id.store, id.register, id.user],
  );
  await pool.query('INSERT INTO prodx_categories(id,organization_id,store_id,name,slug) VALUES($1,$2,$3,$4,$5)', [
    id.category, id.org, id.store, 'Payment lifecycle', `pay-category-${suffix}`,
  ]);
  await pool.query(
    "INSERT INTO prodx_products(id,organization_id,store_id,category_id,sku,barcode,name,price_amount,cost_price_amount,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure) VALUES($1,$2,$3,$4,$5,$5,'Payment lifecycle fixture',12.50,5.00,'THB',0,10,1,'each')",
    [id.product, id.org, id.store, id.category, `PAY-${suffix}`],
  );
}

test('PostgreSQL payment lifecycle serializes duplicate provider events and isolates tenants', async (t) => {
  if (!pool || !db) { t.skip('DATABASE_URL not configured'); return; }
  t.after(async () => { await pool.end(); });
  await seed();

  const order = await createCheckoutService(db).checkout(checkoutRequest('payment-lifecycle-order'));

  // The payments table is shared by lifecycle, refund, and void flows. Probe the
  // complete allowed status union inside a rolled-back transaction so this test
  // catches migration ordering/constraint drift without retaining fixture changes.
  const statusProbe = await pool.connect();
  try {
    await statusProbe.query('BEGIN');
    for (const status of ['pending', 'authorized', 'captured', 'settled', 'failed', 'cancelled', 'unknown', 'voided']) {
      await statusProbe.query(
        'UPDATE prodx_payments SET status=$1 WHERE id=$2 AND store_id=$3',
        [status, id.payment, id.store],
      );
    }
    await statusProbe.query('ROLLBACK');
  } catch (error) {
    await statusProbe.query('ROLLBACK');
    throw error;
  } finally {
    statusProbe.release();
  }

  await pool.query("UPDATE prodx_payments SET status='authorized' WHERE id=$1 AND store_id=$2", [id.payment, id.store]);
  const lifecycle = createPaymentLifecycleService(db);
  const command = {
    storeId: id.store,
    orderId: order.order.id,
    paymentId: id.payment,
    idempotencyKey: 'stripe-test-event-duplicate',
    to: 'captured' as const,
    provider: 'stripe',
    providerReference: 'pi_test_promptpay_123',
  };

  const [first, replay] = await Promise.all([
    lifecycle.transition(command),
    lifecycle.transition(command),
  ]);
  assert.equal(first.id, replay.id, 'concurrent delivery of the same provider event must resolve to one attempt');
  assert.equal(first.status, 'captured');
  assert.equal((await pool.query(
    'SELECT count(*)::int AS count FROM prodx_payment_attempts WHERE store_id=$1 AND idempotency_key=$2',
    [id.store, command.idempotencyKey],
  )).rows[0].count, 1);

  const payment = (await pool.query(
    'SELECT status, provider, provider_reference FROM prodx_payments WHERE id=$1 AND store_id=$2',
    [id.payment, id.store],
  )).rows[0];
  assert.deepEqual(payment, { status: 'captured', provider: 'stripe', provider_reference: 'pi_test_promptpay_123' });

  assert.equal((await pool.query(
    `SELECT count(*)::int AS count FROM prodx_audit_log
     WHERE store_id=$1 AND action='payment_lifecycle_transition'
       AND details->>'idempotencyKey'=$2`,
    [id.store, command.idempotencyKey],
  )).rows[0].count, 1, 'the successful lifecycle transition must emit exactly one audit event');

  await assert.rejects(
    lifecycle.transition({ ...command, storeId: id.foreignStore }),
    (error: unknown) => error instanceof PaymentLifecycleError && /does not belong/.test(error.message),
    'a different tenant must not read or mutate the original tenant payment',
  );
  assert.equal((await pool.query(
    'SELECT count(*)::int AS count FROM prodx_payment_attempts WHERE store_id=$1 AND idempotency_key=$2',
    [id.foreignStore, command.idempotencyKey],
  )).rows[0].count, 0, 'idempotency replay must not cross tenant boundaries');

  await assert.rejects(
    lifecycle.transition({ ...command, idempotencyKey: 'stripe-test-invalid-regression', to: 'failed' }),
    (error: unknown) => error instanceof PaymentLifecycleError && /Invalid payment transition/.test(error.message),
    'a captured payment must not regress to failed',
  );
  assert.equal((await pool.query(
    'SELECT count(*)::int AS count FROM prodx_payment_attempts WHERE store_id=$1 AND payment_id=$2',
    [id.store, id.payment],
  )).rows[0].count, 1, 'rejected transitions must not append payment attempts');
});
