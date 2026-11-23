import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { createPostgresPool } from '../db/postgres';
import { createTransactionalPostgresExecutor } from '../db/transaction';
import { assertDisposableTestDatabaseUrl } from '../db/test-database-guard';
import type { CheckoutRequest } from '../../src/adapters/types';
import { CheckoutAuthorizationError, CheckoutConflictError, checkoutAuthorizationFingerprint, createCheckoutService } from './checkout-service';
import { runWithRequestContext } from '../http/request-context-storage';

const url = process.env.DATABASE_URL?.trim();
if (url) {
  assertDisposableTestDatabaseUrl(url);
}
const pool = url ? createPostgresPool({ connectionString: url, max: 8 }) : null;
const db = pool ? createTransactionalPostgresExecutor(pool) : null;

// Keep append-only audit/financial history; isolate each run with unique fixture IDs.
const id = {
  org: randomUUID(),
  store: randomUUID(),
  store2: randomUUID(),
  user: randomUUID(),
  supervisor: randomUUID(),
  supervisorRole: randomUUID(),
  reg: randomUUID(),
  reg2: randomUUID(),
  shift: randomUUID(),
  shift2: randomUUID(),
  cat: randomUUID(),
  product: randomUUID(),
  product2: randomUUID(),
  product3: randomUUID(),
  device: randomUUID(),
  session: randomUUID(),
  payment: randomUUID(),
};
const runSuffix = id.org.replaceAll('-', '').slice(0, 12);

const req = (key: string, overrides: Partial<CheckoutRequest> = {}): CheckoutRequest => ({
  idempotencyKey: key,
  storeId: id.store,
  registerId: id.reg,
  cashierId: id.user,
  items: [{
    lineId: 'line',
    product: {
      id: id.product, storeId: id.store, sku: `PG-1-${runSuffix}`, barcode: `PG-1-${runSuffix}`, name: 'PG Product 1',
      categoryId: id.cat, price: { amountInCents: 1000, currency: 'THB' }, costPrice: { amountInCents: 500, currency: 'THB' },
      taxRateBps: 0, currentStock: 20, reorderPoint: 1, unitOfMeasure: 'each',
    },
    quantity: 2,
    unitPrice: { amountInCents: 1000, currency: 'THB' },
    discountBps: 0,
    lineSubtotal: { amountInCents: 2000, currency: 'THB' },
    lineTax: { amountInCents: 0, currency: 'THB' },
    lineTotal: { amountInCents: 2000, currency: 'THB' },
  }],
  totals: {
    grossSubtotal: { amountInCents: 2000, currency: 'THB' },
    itemDiscounts: { amountInCents: 0, currency: 'THB' },
    orderDiscount: { amountInCents: 0, currency: 'THB' },
    netSubtotal: { amountInCents: 2000, currency: 'THB' },
    totalTax: { amountInCents: 0, currency: 'THB' },
    grandTotal: { amountInCents: 2000, currency: 'THB' },
    totalItemsCount: 2,
  },
  payments: [{
    id: id.payment,
    method: 'cash',
    amount: { amountInCents: 2000, currency: 'THB' },
    tenderedCash: { amountInCents: 2000, currency: 'THB' },
    changeGiven: { amountInCents: 0, currency: 'THB' },
    timestamp: '2026-09-14T00:00:00.000Z',
  }],
  ...overrides,
});

async function seed() {
  if (!pool) throw new Error('DATABASE_URL required');
  await pool.query('INSERT INTO prodx_organizations(id,code,name) VALUES($1,$2,$3)', [id.org, `pg-core-${runSuffix}`, 'PG Core']);
  await pool.query('INSERT INTO prodx_stores(id,organization_id,code,name,business_timezone) VALUES($1,$2,$3,$4,$5),($6,$2,$7,$8,$5)', [id.store, id.org, `pg-1-${runSuffix}`, 'PG Store 1', 'Asia/Bangkok', id.store2, `pg-2-${runSuffix}`, 'PG Store 2']);
  await pool.query('INSERT INTO prodx_users(id,organization_id,username,display_name) VALUES($1,$2,$3,$4),($5,$2,$6,$7)', [id.user, id.org, `pg-user-${runSuffix}`, 'PG Cashier', id.supervisor, `pg-supervisor-${runSuffix}`, 'PG Supervisor']);
  await pool.query('INSERT INTO prodx_store_memberships(organization_id,store_id,user_id,active) VALUES($1,$2,$3,TRUE),($1,$2,$4,TRUE)', [id.org, id.store, id.user, id.supervisor]);
  await pool.query("INSERT INTO prodx_roles(id,organization_id,role_key,name,active) VALUES($1,$2,'supervisor','Supervisor',TRUE)", [id.supervisorRole, id.org]);
  await pool.query("INSERT INTO prodx_permissions(id,permission_key,description) VALUES($1,'pos.discount.approve','Approve discounts') ON CONFLICT (permission_key) DO NOTHING", [randomUUID()]);
  await pool.query("INSERT INTO prodx_role_permissions(organization_id,role_id,permission_id) SELECT $1,$2,id FROM prodx_permissions WHERE permission_key='pos.discount.approve' ON CONFLICT DO NOTHING", [id.org, id.supervisorRole]);
  await pool.query('INSERT INTO prodx_user_roles(organization_id,store_id,user_id,role_id,active) VALUES($1,$2,$3,$4,TRUE)', [id.org, id.store, id.supervisor, id.supervisorRole]);
  await pool.query('INSERT INTO prodx_devices(id,organization_id,store_id,device_key,name) VALUES($1,$2,$3,$4,$5)', [id.device, id.org, id.store, `pg-device-${runSuffix}`, 'PG Device']);
  await pool.query("INSERT INTO prodx_sessions(id,organization_id,user_id,device_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP + INTERVAL '1 hour')", [id.session, id.org, id.user, id.device, `pg-session-token-hash-${runSuffix}`]);
  await pool.query('INSERT INTO prodx_registers(id,organization_id,store_id,code,name) VALUES($1,$2,$3,$4,$5),($6,$2,$3,$7,$8)', [id.reg, id.org, id.store, `R1-${runSuffix}`, 'Register 1', id.reg2, `R2-${runSuffix}`, 'Register 2']);
  await pool.query("INSERT INTO prodx_shifts(id,organization_id,store_id,register_id,cashier_id,opening_float_amount,currency) VALUES($1,$2,$3,$4,$5,0,'THB'),($6,$2,$3,$7,$5,0,'THB')", [id.shift, id.org, id.store, id.reg, id.user, id.shift2, id.reg2]);
  await pool.query('INSERT INTO prodx_categories(id,organization_id,store_id,name,slug) VALUES($1,$2,$3,$4,$5)', [id.cat, id.org, id.store, 'Category', `category-${runSuffix}`]);
  await pool.query("INSERT INTO prodx_products(id,organization_id,store_id,category_id,sku,barcode,name,price_amount,cost_price_amount,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure) VALUES($1,$2,$3,$4,$5,$5,'PG Product 1',10.00,5.00,'THB',0,20,1,'each'),($6,$2,$3,$4,$7,$7,'PG Product 2',10.00,5.00,'THB',0,20,1,'each'),($8,$2,$3,$4,$9,$9,'PG Product 3',10.00,5.00,'THB',0,20,1,'each')", [id.product, id.org, id.store, id.cat, `PG-1-${runSuffix}`, id.product2, `PG-2-${runSuffix}`, id.product3, `PG-3-${runSuffix}`]);
}

test('PostgreSQL checkout proves atomicity, authoritative pricing, idempotency and store isolation', async (t) => {
  if (!pool || !db) { t.skip('DATABASE_URL not configured'); return; }
  t.after(async () => {
    try {
      await pool.query('DELETE FROM prodx_supervisor_authorizations WHERE organization_id = $1', [id.org]);
    } finally {
      await pool.end();
    }
  });
  await seed();

  const service = createCheckoutService(db);
  const first = await service.checkout(req('success'));
  assert.equal(first.order.totals.grandTotal.amountInCents, 2000);
  assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.product])).rows[0].current_stock, 18);
  assert.match((await pool.query('SELECT idempotency_payload_hash FROM prodx_orders WHERE id=$1', [first.order.id])).rows[0].idempotency_payload_hash, /^[a-f0-9]{64}$/);

  const cached = await service.checkout(req('success'));
  assert.equal(cached.idempotencyCached, true);
  assert.equal(cached.order.id, first.order.id);

  await assert.rejects(
    service.checkout(req('success', { payments: [{ ...req('success').payments[0], tenderedCash: { amountInCents: 2000, currency: 'USD' } }] })),
    (error: unknown) => error instanceof CheckoutConflictError,
  );
  assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_orders WHERE idempotency_key=$1 AND store_id=$2', ['success', id.store])).rows[0].n, 1);

  await assert.rejects(
    service.checkout(req('success', { items: [{ ...req('success').items[0], quantity: 1 }] })),
    (error: unknown) => error instanceof CheckoutConflictError,
  );
  assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.product])).rows[0].current_stock, 18);

  const badPaymentId = randomUUID();
  const bad = [{ ...req('rollback').payments[0], id: badPaymentId }, { ...req('rollback').payments[0], id: badPaymentId }];
  const before = (await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.product])).rows[0].current_stock;
  await assert.rejects(service.checkout(req('rollback', { payments: bad })));
  assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.product])).rows[0].current_stock, before);
  assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_orders WHERE idempotency_key=$1 AND store_id=$2', ['rollback', id.store])).rows[0].n, 0);

  const concurrentPayment = { ...req('concurrent').payments[0], id: randomUUID() };
  const concurrentRequest = req('concurrent', { payments: [concurrentPayment] });
  const results = await Promise.all([1, 2, 3, 4].map(() => service.checkout(concurrentRequest)));
  assert.equal(new Set(results.map((r) => r.order.id)).size, 1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_orders WHERE idempotency_key=$1 AND store_id=$2', ['concurrent', id.store])).rows[0].n, 1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_payments p JOIN prodx_orders o ON o.id=p.order_id WHERE o.idempotency_key=$1 AND o.store_id=$2', ['concurrent', id.store])).rows[0].n, 1);
  await assert.rejects(service.checkout(req('cross-store', { storeId: id.store2 })));

  // Distinct shifts and idempotency keys must serialize product locks in the same UUID order even when clients submit opposite item orders.
  const lineA = { ...req('race-a').items[0], lineId: 'race-a-product-1', quantity: 1, lineSubtotal: { amountInCents: 1000, currency: 'THB' }, lineTotal: { amountInCents: 1000, currency: 'THB' }, product: { ...req('race-a').items[0].product, id: id.product } };
  const lineB = { ...req('race-a').items[0], lineId: 'race-a-product-2', quantity: 1, lineSubtotal: { amountInCents: 1000, currency: 'THB' }, lineTotal: { amountInCents: 1000, currency: 'THB' }, product: { ...req('race-a').items[0].product, id: id.product2, sku: `PG-2-${runSuffix}`, barcode: `PG-2-${runSuffix}`, name: 'PG Product 2' } };
  const raceItems = [lineA, lineB];
  const raceTotals = { grossSubtotal: { amountInCents: 2000, currency: 'THB' }, itemDiscounts: { amountInCents: 0, currency: 'THB' }, orderDiscount: { amountInCents: 0, currency: 'THB' }, netSubtotal: { amountInCents: 2000, currency: 'THB' }, totalTax: { amountInCents: 0, currency: 'THB' }, grandTotal: { amountInCents: 2000, currency: 'THB' }, totalItemsCount: 2 };
  const raceRequest = (key: string, registerId: string, paymentId: string, items: typeof raceItems) => req(key, { registerId, items, totals: raceTotals, payments: [{ ...req(key).payments[0], id: paymentId, amount: { amountInCents: 2000, currency: 'THB' }, tenderedCash: { amountInCents: 2000, currency: 'THB' }, changeGiven: { amountInCents: 0, currency: 'THB' } }] });
  const stockBeforeRace = (await pool.query('SELECT id,current_stock FROM prodx_products WHERE id=ANY($1::uuid[]) ORDER BY id', [[id.product, id.product2]])).rows;
  const races = await Promise.all([raceRequest('opposite-order-a', id.reg, randomUUID(), raceItems), raceRequest('opposite-order-b', id.reg2, randomUUID(), [...raceItems].reverse())].map((r) => service.checkout(r)));
  assert.equal(new Set(races.map((r) => r.order.id)).size, 2);
  const stockAfterRace = (await pool.query('SELECT id,current_stock FROM prodx_products WHERE id=ANY($1::uuid[]) ORDER BY id', [[id.product, id.product2]])).rows;
  assert.deepEqual(stockAfterRace.map((r: any) => Number(r.current_stock)), stockBeforeRace.map((r: any) => Number(r.current_stock) - 2));
  assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_orders WHERE idempotency_key IN ($1,$2) AND store_id=$3', ['opposite-order-a', 'opposite-order-b', id.store])).rows[0].n, 2);

  const requestContext = { requestId: randomUUID(), principal: { userId: id.user, organizationId: id.org, storeId: id.store } };
  const authorizationContext = { organizationId: id.org, storeId: id.store, userId: id.user, sessionId: id.session };
  const discountedRequest = req('order-discount', {
    orderDiscountBps: 1000,
    totals: { ...req('order-discount').totals, orderDiscount: { amountInCents: 200, currency: 'THB' }, netSubtotal: { amountInCents: 1800, currency: 'THB' }, grandTotal: { amountInCents: 1800, currency: 'THB' } },
    payments: [{ ...req('order-discount').payments[0], id: randomUUID(), amount: { amountInCents: 1800, currency: 'THB' }, tenderedCash: { amountInCents: 1800, currency: 'THB' }, changeGiven: { amountInCents: 0, currency: 'THB' } }],
  });
  const discounted = await runWithRequestContext(requestContext, () => service.checkout(discountedRequest, authorizationContext));
  assert.equal(discounted.order.totals.orderDiscount.amountInCents, 200);
  assert.equal(discounted.order.totals.grandTotal.amountInCents, 1800);

  // Three equal lines and a 1.00 discount create tied largest remainders; the database refund guard must use deterministic UUID tie-breaking.
  const multiLines = [id.product, id.product2, id.product3].map((productId, index) => ({ ...req('multi-line-discount').items[0], lineId: `multi-${index}`, product: { ...req('multi-line-discount').items[0].product, id: productId, sku: `PG-${index + 1}-${runSuffix}`, barcode: `PG-${index + 1}-${runSuffix}`, name: `PG Product ${index + 1}` }, quantity: 1, lineSubtotal: { amountInCents: 1000, currency: 'THB' }, lineTotal: { amountInCents: 1000, currency: 'THB' } }));
  const multiTotals = { grossSubtotal: { amountInCents: 3000, currency: 'THB' }, itemDiscounts: { amountInCents: 0, currency: 'THB' }, orderDiscount: { amountInCents: 100, currency: 'THB' }, netSubtotal: { amountInCents: 2900, currency: 'THB' }, totalTax: { amountInCents: 0, currency: 'THB' }, grandTotal: { amountInCents: 2900, currency: 'THB' }, totalItemsCount: 3 };
  const multi = await runWithRequestContext(requestContext, () => service.checkout(req('multi-line-discount', { items: multiLines, orderDiscountBps: 333, totals: multiTotals, payments: [{ ...req('multi-line-discount').payments[0], id: randomUUID(), amount: { amountInCents: 2900, currency: 'THB' }, tenderedCash: { amountInCents: 2900, currency: 'THB' }, changeGiven: { amountInCents: 0, currency: 'THB' } }] }), authorizationContext));
  assert.equal(multi.order.totals.orderDiscount.amountInCents, 100);
  assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_order_items WHERE order_id=$1', [multi.order.id])).rows[0].n, 3);

  // Server policy is authoritative: exactly 15% is permitted, while 15.01% is
  // denied before order/payment/stock writes even when the cashier has pos.discount.
  await pool.query('UPDATE prodx_discount_policies SET require_supervisor_approval=TRUE, max_discount_without_approval_bps=1500 WHERE organization_id=$1 AND store_id=$2', [id.org, id.store]);
  const discountedRequestForPolicy = (key: string, bps: number): CheckoutRequest => {
    const base = req(key);
    const discount = Math.round(2000 * bps / 10000);
    const grand = 2000 - discount;
    return {
      ...base,
      items: [{ ...base.items[0], discountBps: bps, lineSubtotal: { amountInCents: grand, currency: 'THB' }, lineTotal: { amountInCents: grand, currency: 'THB' } }],
      totals: { grossSubtotal: { amountInCents: 2000, currency: 'THB' }, itemDiscounts: { amountInCents: discount, currency: 'THB' }, orderDiscount: { amountInCents: 0, currency: 'THB' }, netSubtotal: { amountInCents: grand, currency: 'THB' }, totalTax: { amountInCents: 0, currency: 'THB' }, grandTotal: { amountInCents: grand, currency: 'THB' }, totalItemsCount: 2 },
      payments: [{ ...base.payments[0], id: randomUUID(), amount: { amountInCents: grand, currency: 'THB' }, tenderedCash: { amountInCents: grand, currency: 'THB' }, changeGiven: { amountInCents: 0, currency: 'THB' } }],
    };
  };

  const exact = await runWithRequestContext(requestContext, () => service.checkout(discountedRequestForPolicy('exact-threshold', 1500), authorizationContext));
  assert.equal(exact.order.totals.grandTotal.amountInCents, 1700);
  const stockAfterExact = (await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.product])).rows[0].current_stock;

  await assert.rejects(
    runWithRequestContext(requestContext, () => service.checkout(discountedRequestForPolicy('over-threshold', 1501), authorizationContext)),
    (error: unknown) => error instanceof CheckoutAuthorizationError && error.code === 'DISCOUNT_SUPERVISOR_APPROVAL_REQUIRED',
  );
  assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.product])).rows[0].current_stock, stockAfterExact);
  assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_orders WHERE idempotency_key=$1 AND store_id=$2', ['over-threshold', id.store])).rows[0].n, 0);

  // A real PostgreSQL race: only one request consumes the supervisor token and
  // writes the order; the concurrent same-command retry resolves to the cached order.
  const token = `pg-one-time-discount-token-${runSuffix}`;
  const concurrent = discountedRequestForPolicy('authorized-concurrent', 1600);
  const payloadHash = checkoutAuthorizationFingerprint(concurrent);
  await pool.query(
    `INSERT INTO prodx_supervisor_authorizations
      (id,organization_id,store_id,requester_user_id,requester_session_id,supervisor_user_id,action_key,order_id,
       checkout_idempotency_key,checkout_payload_hash,policy_threshold_bps,policy_requires_approval,authorization_hash,expires_at)
     VALUES($1,$2,$3,$4,$5,$9,'discount',NULL,$6,$7,1500,TRUE,$8,CURRENT_TIMESTAMP + INTERVAL '2 minutes')`,
    [randomUUID(), id.org, id.store, id.user, id.session, concurrent.idempotencyKey, payloadHash, createHash('sha256').update(token).digest('hex'), id.supervisor],
  );
  const approved = { ...concurrent, supervisorAuthorizationToken: token };
  const approvedContext = { organizationId: id.org, storeId: id.store, userId: id.user, sessionId: id.session };
  const approvedResults = await runWithRequestContext(requestContext, () => Promise.all([
    service.checkout(approved, approvedContext),
    service.checkout(approved, approvedContext),
  ]));
  assert.equal(approvedResults[0].order.id, approvedResults[1].order.id);
  assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_orders WHERE idempotency_key=$1 AND store_id=$2', ['authorized-concurrent', id.store])).rows[0].n, 1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_payments p JOIN prodx_orders o ON o.id=p.order_id WHERE o.idempotency_key=$1 AND o.store_id=$2', ['authorized-concurrent', id.store])).rows[0].n, 1);
  assert.ok((await pool.query('SELECT consumed_at FROM prodx_supervisor_authorizations WHERE checkout_idempotency_key=$1', ['authorized-concurrent'])).rows[0].consumed_at);
  const stockAfterConcurrent = (await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.product])).rows[0].current_stock;

  await assert.rejects(
    runWithRequestContext(requestContext, () => service.checkout({ ...approved, idempotencyKey: 'different-command' }, approvedContext)),
    (error: unknown) => error instanceof CheckoutAuthorizationError && error.code === 'DISCOUNT_SUPERVISOR_AUTHORIZATION_INVALID',
  );
  assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.product])).rows[0].current_stock, stockAfterConcurrent);
});
