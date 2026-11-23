import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { createPostgresPool, resolveConfiguredDatabaseUrl } from '../db/postgres';
import { createTransactionalPostgresExecutor } from '../db/transaction';
import { assertDisposableTestDatabaseUrl } from '../db/test-database-guard';
import { createCheckoutService } from './checkout-service';
import {
  createVoidService,
  VoidConflictError,
  VoidProviderUnavailableError,
} from './void-service';
import { createApp } from '../http/createApp';
import { registerVoidRoute } from '../http/void-route';
import { runWithRequestContext } from '../http/request-context-storage';
import type { CheckoutRequest } from '../../src/adapters/types';

const url = resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);
if (url) {
  assertDisposableTestDatabaseUrl(url);
}
const pool = url ? createPostgresPool({ connectionString: url, max: 8 }) : null;
const db = pool ? createTransactionalPostgresExecutor(pool) : null;

const id = {
  org: randomUUID(),
  store: randomUUID(),
  user: randomUUID(),
  supervisor: randomUUID(),
  device: randomUUID(),
  session: randomUUID(),
  reg: randomUUID(),
  shift: randomUUID(),
  cat: randomUUID(),
  product: randomUUID(),
};
const runSuffix = id.org.replaceAll('-', '').slice(0, 12);

const makeCheckout = (key: string, method: 'cash' | 'card' = 'cash'): CheckoutRequest => ({
  idempotencyKey: key,
  storeId: id.store,
  registerId: id.reg,
  cashierId: id.user,
  items: [{
    lineId: `line-${key}`,
    product: {
      id: id.product,
      storeId: id.store,
      sku: `VD-1-${runSuffix}`,
      barcode: `VD-1-${runSuffix}`,
      name: 'Void Test Product',
      categoryId: id.cat,
      price: { amountInCents: 1500, currency: 'THB' },
      costPrice: { amountInCents: 700, currency: 'THB' },
      taxRateBps: 0,
      currentStock: 20,
      reorderPoint: 1,
      unitOfMeasure: 'each',
    },
    quantity: 3,
    unitPrice: { amountInCents: 1500, currency: 'THB' },
    discountBps: 0,
    lineSubtotal: { amountInCents: 4500, currency: 'THB' },
    lineTax: { amountInCents: 0, currency: 'THB' },
    lineTotal: { amountInCents: 4500, currency: 'THB' },
  }],
  totals: {
    grossSubtotal: { amountInCents: 4500, currency: 'THB' },
    itemDiscounts: { amountInCents: 0, currency: 'THB' },
    orderDiscount: { amountInCents: 0, currency: 'THB' },
    netSubtotal: { amountInCents: 4500, currency: 'THB' },
    totalTax: { amountInCents: 0, currency: 'THB' },
    grandTotal: { amountInCents: 4500, currency: 'THB' },
    totalItemsCount: 3,
  },
  payments: [{
    id: randomUUID(),
    method,
    amount: { amountInCents: 4500, currency: 'THB' },
    tenderedCash: method === 'cash' ? { amountInCents: 4500, currency: 'THB' } : undefined,
    changeGiven: method === 'cash' ? { amountInCents: 0, currency: 'THB' } : undefined,
    timestamp: '2026-11-23T10:00:00.000Z',
  }],
});

async function seed(): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL required');
  await pool.query('INSERT INTO prodx_organizations(id,code,name) VALUES($1,$2,$3)', [id.org, `vd-org-${runSuffix}`, 'Void Org']);
  await pool.query("INSERT INTO prodx_stores(id,organization_id,code,name,business_timezone) VALUES($1,$2,$3,'Void Store','Asia/Bangkok')", [id.store, id.org, `vd-store-${runSuffix}`]);
  await pool.query('INSERT INTO prodx_users(id,organization_id,username,display_name) VALUES($1,$2,$3,$4),($5,$2,$6,$7)', [
    id.user, id.org, `vd-cashier-${runSuffix}`, 'Void Cashier',
    id.supervisor, `vd-sup-${runSuffix}`, 'Void Supervisor',
  ]);
  await pool.query('INSERT INTO prodx_store_memberships(organization_id,store_id,user_id) VALUES($1,$2,$3),($1,$2,$4)', [id.org, id.store, id.user, id.supervisor]);
  await pool.query('INSERT INTO prodx_devices(id,organization_id,store_id,device_key,name) VALUES($1,$2,$3,$4,$5)', [id.device, id.org, id.store, `vd-dev-${runSuffix}`, 'Void Device']);
  await pool.query("INSERT INTO prodx_sessions(id,organization_id,user_id,device_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP + INTERVAL '1 hour')", [id.session, id.org, id.user, id.device, `vd-sess-${runSuffix}`]);
  await pool.query('INSERT INTO prodx_registers(id,organization_id,store_id,code,name) VALUES($1,$2,$3,$4,$5)', [id.reg, id.org, id.store, `VDR1-${runSuffix}`, 'Void Register']);
  await pool.query("INSERT INTO prodx_shifts(id,organization_id,store_id,register_id,cashier_id,opening_float_amount,currency) VALUES($1,$2,$3,$4,$5,100.00,'THB')", [id.shift, id.org, id.store, id.reg, id.user]);
  await pool.query('INSERT INTO prodx_categories(id,organization_id,store_id,name,slug) VALUES($1,$2,$3,$4,$5)', [id.cat, id.org, id.store, 'Void Cat', `vd-cat-${runSuffix}`]);
  await pool.query("INSERT INTO prodx_products(id,organization_id,store_id,category_id,sku,barcode,name,price_amount,cost_price_amount,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure) VALUES($1,$2,$3,$4,$5,$5,'Void Test Product',15.00,7.00,'THB',0,20,1,'each')", [id.product, id.org, id.store, id.cat, `VD-1-${runSuffix}`]);
}

async function grantVoidSupervisorToken(orderId: string, token: string): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL required');
  await pool.query(
    `INSERT INTO prodx_supervisor_authorizations
      (id,organization_id,store_id,requester_user_id,requester_session_id,supervisor_user_id,action_key,order_id,authorization_hash,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,'void',$7,$8,CURRENT_TIMESTAMP + INTERVAL '2 minutes')`,
    [randomUUID(), id.org, id.store, id.user, id.session, id.supervisor, orderId, createHash('sha256').update(token).digest('hex')],
  );
}

test('PostgreSQL void is atomic, reverses stock and cash, enforces immutability, handles concurrent replay, fails closed on non-cash, and persists audit log', async (t) => {
  if (!pool || !db) { t.skip('DATABASE_URL not configured'); return; }
  await seed();
  t.after(async () => {
    try {
      await pool.query('DELETE FROM prodx_supervisor_authorizations WHERE organization_id = $1', [id.org]);
    } finally {
      await pool.end();
    }
  });

  const checkout = createCheckoutService(db);
  const voidService = createVoidService(db);

  // 1. Commit a cash sale (stock 20 -> 17)
  const sale = await checkout.checkout(makeCheckout(`void-sale-1-${runSuffix}`, 'cash'));
  assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.product])).rows[0].current_stock, 17);

  const requestContext = {
    requestId: randomUUID(),
    principal: { userId: id.user, organizationId: id.org, storeId: id.store, sessionId: id.session },
  };
  const voidOrderInContext = (input: Parameters<typeof voidService.voidOrder>[0]) =>
    runWithRequestContext(requestContext, () => voidService.voidOrder(input));

  // 2. Concurrent void replay with same idempotencyKey -> single void, single reversal
  const token1 = `void-token-1-${runSuffix}`;
  await grantVoidSupervisorToken(sale.order.id, token1);
  const voidKey = `void-idem-1-${runSuffix}`;
  const concurrentResults = await Promise.all([
    voidOrderInContext({
      storeId: id.store, orderId: sale.order.id, reason: 'Cashier mistyped order',
      idempotencyKey: voidKey, requesterUserId: id.user, requesterSessionId: id.session,
      supervisorAuthorizationToken: token1,
    }),
    voidOrderInContext({
      storeId: id.store, orderId: sale.order.id, reason: 'Cashier mistyped order',
      idempotencyKey: voidKey, requesterUserId: id.user, requesterSessionId: id.session,
      supervisorAuthorizationToken: token1,
    }),
  ]);
  assert.equal(concurrentResults[0].voidId, concurrentResults[1].voidId);
  assert.equal(concurrentResults.filter((r) => !r.idempotencyCached).length, 1);
  assert.equal(concurrentResults.filter((r) => r.idempotencyCached).length, 1);

  // Verify stock restored (17 -> 20) and void_reversal ledger entry recorded exactly once
  assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.product])).rows[0].current_stock, 20);
  const voidLedger = await pool.query(
    "SELECT quantity_delta, resulting_stock, reason, reference_id FROM prodx_inventory_ledger WHERE store_id=$1 AND product_id=$2 AND reason='void_reversal'",
    [id.store, id.product],
  );
  assert.equal(voidLedger.rows.length, 1);
  assert.equal(voidLedger.rows[0].quantity_delta, 3);
  assert.equal(voidLedger.rows[0].resulting_stock, 20);
  assert.equal(voidLedger.rows[0].reference_id, concurrentResults[0].voidId);

  // Verify cash_refund movement recorded exactly once for exact order total 45.00
  const cashReversals = await pool.query(
    "SELECT amount::text AS amount, type FROM prodx_cash_movements WHERE store_id=$1 AND shift_id=$2 AND type='cash_refund'",
    [id.store, id.shift],
  );
  assert.equal(cashReversals.rows.length, 1);
  assert.equal(cashReversals.rows[0].amount, '45.00');

  // Verify order status updated to voided & audit log persisted
  assert.equal((await pool.query('SELECT status FROM prodx_orders WHERE id=$1', [sale.order.id])).rows[0].status, 'voided');
  const audits = await pool.query(
    "SELECT action, severity, details FROM prodx_audit_log WHERE store_id=$1 AND action='order_void_committed'",
    [id.store],
  );
  assert.equal(audits.rows.length, 1);
  assert.equal(audits.rows[0].severity, 'critical');
  assert.equal(audits.rows[0].details.voidId, concurrentResults[0].voidId);

  // 3. Immutable guard on prodx_voids rejects UPDATE and DELETE
  await assert.rejects(pool.query('UPDATE prodx_voids SET reason=$1 WHERE id=$2', ['tampered', concurrentResults[0].voidId]));
  await assert.rejects(pool.query('DELETE FROM prodx_voids WHERE id=$1', [concurrentResults[0].voidId]));

  // 4. Reusing same void idempotencyKey for a different order throws VoidConflictError
  const sale2 = await checkout.checkout(makeCheckout(`void-sale-2-${runSuffix}`, 'cash'));
  const token2 = `void-token-2-${runSuffix}`;
  await grantVoidSupervisorToken(sale2.order.id, token2);
  await assert.rejects(
    voidOrderInContext({
      storeId: id.store, orderId: sale2.order.id, reason: 'Duplicate key abuse',
      idempotencyKey: voidKey, requesterUserId: id.user, requesterSessionId: id.session,
      supervisorAuthorizationToken: token2,
    }),
    (error: unknown) => error instanceof VoidConflictError,
  );

  // 5. Non-cash (card) void fails closed with VoidProviderUnavailableError (HTTP 503 at route boundary)
  const cardSale = await checkout.checkout(makeCheckout(`void-card-sale-${runSuffix}`, 'card'));
  const stockBeforeCardVoid = (await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.product])).rows[0].current_stock;
  const cardToken = `void-card-token-${runSuffix}`;
  await grantVoidSupervisorToken(cardSale.order.id, cardToken);

  await assert.rejects(
    voidOrderInContext({
      storeId: id.store, orderId: cardSale.order.id, reason: 'Card void attempt',
      idempotencyKey: `void-card-idem-${runSuffix}`, requesterUserId: id.user, requesterSessionId: id.session,
      supervisorAuthorizationToken: cardToken,
    }),
    (error: unknown) => error instanceof VoidProviderUnavailableError,
  );

  // Also verify HTTP route returns 503 fail-closed
  const cardTokenHttp = `void-card-token-http-${runSuffix}`;
  await grantVoidSupervisorToken(cardSale.order.id, cardTokenHttp);
  const app = createApp({
    authenticateRequest: () => ({ userId: id.user, organizationId: id.org, storeId: id.store, sessionId: id.session }),
    authorizeRequest: () => true,
    configureRoutes: (configured) => registerVoidRoute(configured, db),
  });
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const resp = await fetch(`http://127.0.0.1:${address.port}/api/v1/orders/void`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderId: cardSale.order.id,
        reason: 'Card void over HTTP',
        idempotencyKey: `void-card-http-idem-${runSuffix}`,
        supervisorAuthorizationToken: cardTokenHttp,
      }),
    });
    assert.equal(resp.status, 503);
    assert.equal((await resp.json()).error.code, 'VOID_PROVIDER_UNAVAILABLE');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }

  // Zero stock/order mutation on failed non-cash void
  assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.product])).rows[0].current_stock, stockBeforeCardVoid);
  assert.equal((await pool.query('SELECT status FROM prodx_orders WHERE id=$1', [cardSale.order.id])).rows[0].status, 'server_confirmed');
  assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_voids WHERE order_id=$1', [cardSale.order.id])).rows[0].n, 0);
});
