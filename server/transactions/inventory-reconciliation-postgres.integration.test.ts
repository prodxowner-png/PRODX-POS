import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { createPostgresPool, resolveConfiguredDatabaseUrl } from '../db/postgres';
import { createTransactionalPostgresExecutor } from '../db/transaction';
import { assertDisposableTestDatabaseUrl } from '../db/test-database-guard';
import { createCheckoutService } from './checkout-service';
import { createRefundService } from './refund-service';
import { createVoidService } from './void-service';
import { createInventoryAdjustmentService } from './inventory-adjustment-service';
import { createApp } from '../http/createApp';
import { registerSyncRoute } from '../http/sync-route';
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
  device: randomUUID(),
  session: randomUUID(),
  reg: randomUUID(),
  shift: randomUUID(),
  cat: randomUUID(),
  productA: randomUUID(),
  productB: randomUUID(),
};
const runSuffix = id.org.replaceAll('-', '').slice(0, 12);

const makeProduct = (productId: string, suffix: string, priceCents = 1000) => ({
  id: productId,
  storeId: id.store,
  sku: `REC-${suffix}-${runSuffix}`,
  barcode: `REC-${suffix}-${runSuffix}`,
  name: `Reconcile Product ${suffix}`,
  categoryId: id.cat,
  price: { amountInCents: priceCents, currency: 'THB' },
  costPrice: { amountInCents: 500, currency: 'THB' },
  taxRateBps: 0,
  currentStock: 0,
  reorderPoint: 1,
  unitOfMeasure: 'each',
});

const makeOrderRequest = (
  key: string,
  lines: Array<{ productId: string; suffix: string; quantity: number }>,
  paymentIds?: string[],
): CheckoutRequest => {
  const items = lines.map((line, index) => ({
    lineId: `${key}-line-${index}`,
    product: makeProduct(line.productId, line.suffix, 1000),
    quantity: line.quantity,
    unitPrice: { amountInCents: 1000, currency: 'THB' },
    discountBps: 0,
    lineSubtotal: { amountInCents: line.quantity * 1000, currency: 'THB' },
    lineTax: { amountInCents: 0, currency: 'THB' },
    lineTotal: { amountInCents: line.quantity * 1000, currency: 'THB' },
  }));
  const totalQty = lines.reduce((sum, l) => sum + l.quantity, 0);
  const grandTotal = totalQty * 1000;
  const payments = (paymentIds ?? [randomUUID()]).map((paymentId) => ({
    id: paymentId,
    method: 'cash' as const,
    amount: { amountInCents: Math.floor(grandTotal / (paymentIds?.length ?? 1)), currency: 'THB' },
    tenderedCash: { amountInCents: Math.floor(grandTotal / (paymentIds?.length ?? 1)), currency: 'THB' },
    changeGiven: { amountInCents: 0, currency: 'THB' },
    timestamp: '2026-11-23T11:00:00.000Z',
  }));
  return {
    idempotencyKey: key,
    storeId: id.store,
    registerId: id.reg,
    cashierId: id.user,
    items,
    totals: {
      grossSubtotal: { amountInCents: grandTotal, currency: 'THB' },
      itemDiscounts: { amountInCents: 0, currency: 'THB' },
      orderDiscount: { amountInCents: 0, currency: 'THB' },
      netSubtotal: { amountInCents: grandTotal, currency: 'THB' },
      totalTax: { amountInCents: 0, currency: 'THB' },
      grandTotal: { amountInCents: grandTotal, currency: 'THB' },
      totalItemsCount: totalQty,
    },
    payments,
  };
};

async function seed(): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL required');
  await pool.query('INSERT INTO prodx_organizations(id,code,name) VALUES($1,$2,$3)', [id.org, `rec-org-${runSuffix}`, 'Reconcile Org']);
  await pool.query("INSERT INTO prodx_stores(id,organization_id,code,name,business_timezone) VALUES($1,$2,$3,'Reconcile Store','Asia/Bangkok')", [id.store, id.org, `rec-store-${runSuffix}`]);
  await pool.query('INSERT INTO prodx_users(id,organization_id,username,display_name) VALUES($1,$2,$3,$4)', [id.user, id.org, `rec-user-${runSuffix}`, 'Reconcile User']);
  await pool.query('INSERT INTO prodx_store_memberships(organization_id,store_id,user_id) VALUES($1,$2,$3)', [id.org, id.store, id.user]);
  const voidRoleId = randomUUID();
  await pool.query('INSERT INTO prodx_roles(id,organization_id,role_key,name) VALUES($1,$2,$3,$4)', [voidRoleId, id.org, `rec-sup-${runSuffix}`, 'Reconcile Supervisor Role']);
  await pool.query("INSERT INTO prodx_permissions(id,permission_key,description) VALUES('10000000-0000-4000-8000-000000000007','pos.void','Void eligible sales') ON CONFLICT (permission_key) DO NOTHING");
  await pool.query("INSERT INTO prodx_role_permissions(organization_id,role_id,permission_id) SELECT $1, $2, id FROM prodx_permissions WHERE permission_key = 'pos.void'", [id.org, voidRoleId]);
  await pool.query('INSERT INTO prodx_user_roles(organization_id,user_id,role_id,store_id) VALUES($1,$2,$3,$4)', [id.org, id.user, voidRoleId, id.store]);
  await pool.query('INSERT INTO prodx_devices(id,organization_id,store_id,device_key,name) VALUES($1,$2,$3,$4,$5)', [id.device, id.org, id.store, `rec-dev-${runSuffix}`, 'Reconcile Device']);
  await pool.query("INSERT INTO prodx_sessions(id,organization_id,user_id,device_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP + INTERVAL '1 hour')", [id.session, id.org, id.user, id.device, `rec-sess-${runSuffix}`]);
  await pool.query('INSERT INTO prodx_registers(id,organization_id,store_id,code,name) VALUES($1,$2,$3,$4,$5)', [id.reg, id.org, id.store, `RECR1-${runSuffix}`, 'Reconcile Register']);
  await pool.query("INSERT INTO prodx_shifts(id,organization_id,store_id,register_id,cashier_id,opening_float_amount,currency) VALUES($1,$2,$3,$4,$5,500.00,'THB')", [id.shift, id.org, id.store, id.reg, id.user]);
  await pool.query('INSERT INTO prodx_categories(id,organization_id,store_id,name,slug) VALUES($1,$2,$3,$4,$5)', [id.cat, id.org, id.store, 'Reconcile Cat', `rec-cat-${runSuffix}`]);
  // Start both products at 0 stock so every unit of inventory is backed by a ledger row
  await pool.query(
    "INSERT INTO prodx_products(id,organization_id,store_id,category_id,sku,barcode,name,price_amount,cost_price_amount,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure) VALUES($1,$2,$3,$4,$5,$5,'Reconcile Product A',10.00,5.00,'THB',0,0,1,'each'),($6,$2,$3,$4,$7,$7,'Reconcile Product B',10.00,5.00,'THB',0,0,1,'each')",
    [id.productA, id.org, id.store, id.cat, `REC-A-${runSuffix}`, id.productB, `REC-B-${runSuffix}`],
  );
}

async function assertInventoryReconciles(): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL required');
  const rows = (await pool.query(
    `SELECT p.id,
            p.current_stock::int AS current_stock,
            COALESCE(SUM(l.quantity_delta), 0)::int AS ledger_sum
       FROM prodx_products p
       LEFT JOIN prodx_inventory_ledger l
         ON l.store_id = p.store_id AND l.product_id = p.id
      WHERE p.store_id = $1
      GROUP BY p.id, p.current_stock
      ORDER BY p.id`,
    [id.store],
  )).rows as Array<{ id: string; current_stock: number; ledger_sum: number }>;

  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(
      row.ledger_sum,
      row.current_stock,
      `Inventory drift detected for product ${row.id}: SUM(ledger)=${row.ledger_sum} != current_stock=${row.current_stock}`,
    );
  }
}

test('PostgreSQL mainline inventory reconciliation, partial-failure rollback, and retry-after-timeout preserve exact stock and financial integrity', async (t) => {
  if (!pool || !db) { t.skip('DATABASE_URL not configured'); return; }
  await seed();
  t.after(async () => {
    try {
      await pool.query('DELETE FROM prodx_supervisor_authorizations WHERE organization_id = $1', [id.org]);
    } finally {
      await pool.end();
    }
  });

  const adjust = createInventoryAdjustmentService(db);
  const checkout = createCheckoutService(db);
  const refund = createRefundService(db);
  const voidService = createVoidService(db);

  // 1. Seed stock via purchase_received ledger entries (A: 0->20, B: 0->2)
  await adjust.adjust({
    storeId: id.store, organizationId: id.org, requesterUserId: id.user,
    productIds: [id.productA], quantityDelta: 20, reason: 'purchase_received',
    idempotencyKey: `rec-init-a-${runSuffix}`,
  });
  await adjust.adjust({
    storeId: id.store, organizationId: id.org, requesterUserId: id.user,
    productIds: [id.productB], quantityDelta: 2, reason: 'purchase_received',
    idempotencyKey: `rec-init-b-${runSuffix}`,
  });

  // 2. Checkout (A: -5 -> 15) + partial refund with restock (A: +2 -> 17)
  const sale1 = await checkout.checkout(makeOrderRequest(`rec-sale-1-${runSuffix}`, [{ productId: id.productA, suffix: 'A', quantity: 5 }]));
  await refund.refund({
    storeId: id.store, orderId: sale1.order.id,
    refundAmount: { amountInCents: 2000, currency: 'THB' },
    reason: 'Partial return', refundMethod: 'cash', authorizedByUserId: id.user,
    itemsToRestock: [{ productId: id.productA, quantity: 2 }],
    idempotencyKey: `rec-refund-1-${runSuffix}`,
  });

  // 3. Second checkout (A: -3 -> 14) + full void (A: +3 -> 17)
  const sale2 = await checkout.checkout(makeOrderRequest(`rec-sale-2-${runSuffix}`, [{ productId: id.productA, suffix: 'A', quantity: 3 }]));
  const voidToken = `rec-void-token-${runSuffix}`;
  await pool.query(
    `INSERT INTO prodx_supervisor_authorizations
      (id,organization_id,store_id,requester_user_id,requester_session_id,supervisor_user_id,action_key,order_id,authorization_hash,expires_at)
     VALUES($1,$2,$3,$4,$5,$4,'void',$6,$7,CURRENT_TIMESTAMP + INTERVAL '2 minutes')`,
    [randomUUID(), id.org, id.store, id.user, id.session, sale2.order.id, createHash('sha256').update(voidToken).digest('hex')],
  );
  const requestContext = {
    requestId: randomUUID(),
    principal: { userId: id.user, organizationId: id.org, storeId: id.store, sessionId: id.session },
  };
  await runWithRequestContext(requestContext, () =>
    voidService.voidOrder({
      storeId: id.store, orderId: sale2.order.id, reason: 'Void full order',
      idempotencyKey: `rec-void-1-${runSuffix}`, requesterUserId: id.user,
      requesterSessionId: id.session, supervisorAuthorizationToken: voidToken,
    }),
  );

  // 4. Manual adjustment write-off (A: -1 -> 16)
  await adjust.adjust({
    storeId: id.store, organizationId: id.org, requesterUserId: id.user,
    productIds: [id.productA], quantityDelta: -1, reason: 'damaged_write_off',
    idempotencyKey: `rec-writeoff-${runSuffix}`,
  });

  assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.productA])).rows[0].current_stock, 16);
  await assertInventoryReconciles();

  // 5. Partial-failure rollback: multi-item checkout where A has enough stock (16 >= 4)
  //    but B has insufficient stock (2 < 5) must roll back completely with zero orphan rows
  const ledgerCountBeforeFail = (await pool.query('SELECT count(*)::int n FROM prodx_inventory_ledger WHERE store_id=$1', [id.store])).rows[0].n;
  const orderCountBeforeFail = (await pool.query('SELECT count(*)::int n FROM prodx_orders WHERE store_id=$1', [id.store])).rows[0].n;
  const auditCountBeforeFail = (await pool.query('SELECT count(*)::int n FROM prodx_audit_log WHERE store_id=$1', [id.store])).rows[0].n;

  await assert.rejects(
    checkout.checkout(
      makeOrderRequest(`rec-partial-fail-${runSuffix}`, [
        { productId: id.productA, suffix: 'A', quantity: 4 },
        { productId: id.productB, suffix: 'B', quantity: 5 },
      ]),
    ),
  );

  assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.productA])).rows[0].current_stock, 16);
  assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.productB])).rows[0].current_stock, 2);
  assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_inventory_ledger WHERE store_id=$1', [id.store])).rows[0].n, ledgerCountBeforeFail);
  assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_orders WHERE store_id=$1', [id.store])).rows[0].n, orderCountBeforeFail);
  assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_audit_log WHERE store_id=$1', [id.store])).rows[0].n, auditCountBeforeFail);
  await assertInventoryReconciles();

  // 6. Retry-after-timeout over real HTTP /api/v1/sync/commands:
  //    Server commits on attempt 1, client aborts AFTER PostgreSQL commit but before receiving response, then retries with same idempotencyKey.
  let signalServerCommitted!: () => void;
  const serverCommitted = new Promise<void>((resolve) => {
    signalServerCommitted = resolve;
  });
  const app = createApp({
    authenticateRequest: () => ({ userId: id.user, organizationId: id.org, storeId: id.store, sessionId: id.session }),
    authorizeRequest: () => true,
    configureRoutes: (configured) => {
      // Simulate post-commit network drop on attempt 1: once checkout commits and invokes res.json,
      // signal the test to abort the client socket instead of delivering the HTTP response.
      let firstAttempt = true;
      configured.use('/api/v1/sync/commands', (_req, res, next) => {
        if (firstAttempt) {
          firstAttempt = false;
          res.json = ((_body: unknown) => {
            signalServerCommitted();
            res.destroy();
            return res;
          }) as typeof res.json;
        }
        next();
      });
      registerSyncRoute(configured, db);
    },
  });
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const timeoutKey = `rec-retry-timeout-${runSuffix}`;
    const payload = makeOrderRequest(timeoutKey, [{ productId: id.productA, suffix: 'A', quantity: 2 }]);
    const outboxItem = {
      id: `outbox-${timeoutKey}`,
      type: 'order_transaction' as const,
      idempotencyKey: timeoutKey,
      payload,
      createdAt: '2026-11-23T11:05:00.000Z',
      attempts: 1,
      syncState: 'queued' as const,
    };

    // Attempt 1: wait deterministically until PostgreSQL commit reaches res.json, then abort client request
    const controller = new AbortController();
    const attempt1 = fetch(`http://127.0.0.1:${address.port}/api/v1/sync/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item: outboxItem }),
      signal: controller.signal,
    });
    await serverCommitted;
    controller.abort();
    await assert.rejects(attempt1);

    // Attempt 2: client retries with exact same idempotencyKey -> returns committed order with idempotencyCached=true
    const retryResp = await fetch(`http://127.0.0.1:${address.port}/api/v1/sync/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item: { ...outboxItem, attempts: 2, syncState: 'failed' } }),
    });
    assert.equal(retryResp.status, 200);
    const retryBody = (await retryResp.json()) as {
      confirmedOrder: { id: string };
      serverConfirmed: boolean;
      idempotencyCached: boolean;
    };
    assert.equal(retryBody.serverConfirmed, true);
    assert.equal(retryBody.idempotencyCached, true);

    // Exactly 1 order, 1 payment, 1 sale deduction (-2: 16 -> 14), and full ledger reconciliation
    assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_orders WHERE store_id=$1 AND idempotency_key=$2', [id.store, timeoutKey])).rows[0].n, 1);
    assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.productA])).rows[0].current_stock, 14);
    await assertInventoryReconciles();
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
