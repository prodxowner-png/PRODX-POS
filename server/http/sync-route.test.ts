import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresPool, resolveConfiguredDatabaseUrl } from '../db/postgres';
import { createTransactionalPostgresExecutor } from '../db/transaction';
import { createApp } from './createApp';
import { registerSyncRoute } from './sync-route';
import type { CheckoutRequest } from '../../src/adapters/types';
import type { TransactionalSqlExecutor } from '../db/transaction';

const url = resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);
const pool = url ? createPostgresPool({ connectionString: url, max: 8 }) : null;
const db = pool ? createTransactionalPostgresExecutor(pool) : null;

const principal = {
  userId: 'user-1',
  organizationId: 'org-1',
  storeId: 'store-1',
  sessionId: 'session-1',
};

const start = async (app: ReturnType<typeof createApp>) => {
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())),
  };
};

const unreachableDb: TransactionalSqlExecutor = {
  query: async () => { throw new Error('database must not be reached'); },
  transaction: async () => { throw new Error('transaction must not be reached'); },
};

test('sync route rejects unsupported outbox command types before database work', async () => {
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: (_context, permission) => permission === 'pos.sell',
    configureRoutes: (configuredApp) => registerSyncRoute(configuredApp, unreachableDb),
  });
  const server = await start(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item: { id: 'outbox-1', type: 'shift_movement', idempotencyKey: 'sync-1', payload: {}, createdAt: '2026-10-02T00:00:00.000Z', attempts: 0, syncState: 'queued' } }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'SYNC_COMMAND_UNSUPPORTED');
  } finally {
    await server.close();
  }
});

test('sync route rejects idempotency mismatch before database work', async () => {
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: (_context, permission) => permission === 'pos.sell',
    configureRoutes: (configuredApp) => registerSyncRoute(configuredApp, unreachableDb),
  });
  const server = await start(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item: { id: 'outbox-2', type: 'order_transaction', idempotencyKey: 'sync-2', payload: { idempotencyKey: 'different-key' }, createdAt: '2026-10-02T00:00:00.000Z', attempts: 0, syncState: 'queued' } }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'SYNC_IDEMPOTENCY_KEY_MISMATCH');
  } finally {
    await server.close();
  }
});

test('sync route rejects discounted offline orders without pos.discount permission', async () => {
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: (_context, permission) => permission === 'pos.sell',
    configureRoutes: (configuredApp) => registerSyncRoute(configuredApp, unreachableDb),
  });
  const server = await start(app);
  try {
    const payload = { idempotencyKey: 'sync-discount-1', registerId: 'register-1', items: [{ discountBps: 500 }], payments: [], totals: {} };
    const response = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item: { id: 'outbox-discount-1', type: 'order_transaction', idempotencyKey: 'sync-discount-1', payload, createdAt: '2026-10-30T00:00:00.000Z', attempts: 0, syncState: 'queued' } }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'DISCOUNT_NOT_AUTHORIZED');
  } finally {
    await server.close();
  }
});

test('sync route denies unauthorized access before database work', async () => {
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: () => false,
    configureRoutes: (configuredApp) => registerSyncRoute(configuredApp, unreachableDb),
  });
  const server = await start(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/sync/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 403);
  } finally {
    await server.close();
  }
});

const request = (key: string): CheckoutRequest => ({
  idempotencyKey: key, storeId: '00000000-0000-4000-8000-000000003002', registerId: '00000000-0000-4000-8000-000000003004', cashierId: '00000000-0000-4000-8000-000000003003',
  items: [{ lineId: 'sync-line', product: { id: '00000000-0000-4000-8000-000000003007', storeId: '00000000-0000-4000-8000-000000003002', sku: 'SYNC-1', barcode: 'SYNC-1', name: 'Sync Product', categoryId: '00000000-0000-4000-8000-000000003006', price: { amountInCents: 1000, currency: 'THB' }, costPrice: { amountInCents: 500, currency: 'THB' }, taxRateBps: 0, currentStock: 10, reorderPoint: 1, unitOfMeasure: 'each' }, quantity: 1, unitPrice: { amountInCents: 1000, currency: 'THB' }, discountBps: 0, lineSubtotal: { amountInCents: 1000, currency: 'THB' }, lineTax: { amountInCents: 0, currency: 'THB' }, lineTotal: { amountInCents: 1000, currency: 'THB' } }],
  totals: { grossSubtotal: { amountInCents: 1000, currency: 'THB' }, itemDiscounts: { amountInCents: 0, currency: 'THB' }, orderDiscount: { amountInCents: 0, currency: 'THB' }, netSubtotal: { amountInCents: 1000, currency: 'THB' }, totalTax: { amountInCents: 0, currency: 'THB' }, grandTotal: { amountInCents: 1000, currency: 'THB' }, totalItemsCount: 1 },
  payments: [{ id: '00000000-0000-4000-8000-000000003008', method: 'cash', amount: { amountInCents: 1000, currency: 'THB' }, tenderedCash: { amountInCents: 1000, currency: 'THB' }, changeGiven: { amountInCents: 0, currency: 'THB' }, timestamp: '2026-10-05T00:00:00.000Z' }],
});

test('production sync HTTP path commits once and returns cached result on replay', async (t) => {
  if (!pool || !db) { t.skip('DATABASE_URL not configured'); return; }
  const ids = { org: '00000000-0000-4000-8000-000000003001', store: '00000000-0000-4000-8000-000000003002', user: '00000000-0000-4000-8000-000000003003', register: '00000000-0000-4000-8000-000000003004', shift: '00000000-0000-4000-8000-000000003005', category: '00000000-0000-4000-8000-000000003006', product: '00000000-0000-4000-8000-000000003007', payment: '00000000-0000-4000-8000-000000003008' };
  const clean = async () => {
    await pool.query('ALTER TABLE prodx_audit_log DISABLE TRIGGER prodx_audit_log_immutable_guard');
    try {
      for (const [sql, params] of [
        ['DELETE FROM prodx_cash_movements WHERE shift_id=$1', [ids.shift]],
        ['DELETE FROM prodx_audit_log WHERE store_id=$1', [ids.store]],
        ['DELETE FROM prodx_payments WHERE store_id=$1', [ids.store]],
        ['DELETE FROM prodx_order_items WHERE store_id=$1', [ids.store]],
        ['DELETE FROM prodx_inventory_ledger WHERE store_id=$1', [ids.store]],
        ['DELETE FROM prodx_orders WHERE store_id=$1', [ids.store]],
        ['DELETE FROM prodx_shifts WHERE id=$1', [ids.shift]],
        ['DELETE FROM prodx_products WHERE id=$1', [ids.product]],
        ['DELETE FROM prodx_categories WHERE id=$1', [ids.category]],
        ['DELETE FROM prodx_registers WHERE id=$1', [ids.register]],
        ['DELETE FROM prodx_store_memberships WHERE store_id=$1', [ids.store]],
        ['DELETE FROM prodx_users WHERE id=$1', [ids.user]],
        ['DELETE FROM prodx_stores WHERE id=$1', [ids.store]],
        ['DELETE FROM prodx_organizations WHERE id=$1', [ids.org]],
      ] as const) await pool.query(sql as string, [...params]);
    } finally {
      await pool.query('ALTER TABLE prodx_audit_log ENABLE TRIGGER prodx_audit_log_immutable_guard');
    }
  };  await clean();
  try {
    await pool.query('INSERT INTO prodx_organizations(id,code,name) VALUES($1,$2,$3)', [ids.org, 'sync-http', 'Sync HTTP']);
    await pool.query('INSERT INTO prodx_stores(id,organization_id,code,name,business_timezone) VALUES($1,$2,$3,$4,$5)', [ids.store, ids.org, 'sync-store', 'Sync Store', 'Asia/Bangkok']);
    await pool.query('INSERT INTO prodx_users(id,organization_id,username,display_name) VALUES($1,$2,$3,$4)', [ids.user, ids.org, 'sync-user', 'Sync User']);
    await pool.query('INSERT INTO prodx_store_memberships(organization_id,store_id,user_id) VALUES($1,$2,$3)', [ids.org, ids.store, ids.user]);
    await pool.query('INSERT INTO prodx_registers(id,organization_id,store_id,code,name) VALUES($1,$2,$3,$4,$5)', [ids.register, ids.org, ids.store, 'SYNC-R1', 'Sync Register']);
    await pool.query("INSERT INTO prodx_shifts(id,organization_id,store_id,register_id,cashier_id,opening_float_amount,currency) VALUES($1,$2,$3,$4,$5,0,'THB')", [ids.shift, ids.org, ids.store, ids.register, ids.user]);
    await pool.query('INSERT INTO prodx_categories(id,organization_id,store_id,name,slug) VALUES($1,$2,$3,$4,$5)', [ids.category, ids.org, ids.store, 'Sync Category', 'sync-category']);
    await pool.query("INSERT INTO prodx_products(id,organization_id,store_id,category_id,sku,barcode,name,price_amount,cost_price_amount,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure) VALUES($1,$2,$3,$4,'SYNC-1','SYNC-1','Sync Product',10.00,5.00,'THB',0,10,1,'each')", [ids.product, ids.org, ids.store, ids.category]);
    const app = createApp({ authenticateRequest: () => ({ userId: ids.user, organizationId: ids.org, storeId: ids.store, sessionId: 'sync-http-session' }), authorizeRequest: (_context, permission) => permission === 'pos.sell', configureRoutes: (configuredApp) => registerSyncRoute(configuredApp, db) });
    const server = await start(app);
    try {
      const item = { id: 'offline-sync-1', type: 'order_transaction' as const, idempotencyKey: 'offline-sync-key', payload: request('offline-sync-key'), createdAt: '2026-10-05T00:00:00.000Z', attempts: 0, syncState: 'queued' as const };
      const first = await fetch(`${server.baseUrl}/api/v1/sync/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item }) });
      assert.equal(first.status, 201);
      const firstBody = await first.json() as { confirmedOrder: { id: string }; serverConfirmed: boolean; idempotencyCached: boolean };
      assert.equal(firstBody.serverConfirmed, true); assert.equal(firstBody.idempotencyCached, false);
      const replay = await fetch(`${server.baseUrl}/api/v1/sync/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: { ...item, attempts: 1 } }) });
      assert.equal(replay.status, 200);
      const replayBody = await replay.json() as { confirmedOrder: { id: string }; serverConfirmed: boolean; idempotencyCached: boolean };
      assert.equal(replayBody.serverConfirmed, true); assert.equal(replayBody.idempotencyCached, true); assert.equal(replayBody.confirmedOrder.id, firstBody.confirmedOrder.id);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM prodx_orders WHERE store_id=$1 AND idempotency_key=$2', [ids.store, item.idempotencyKey])).rows[0].count, 1);
      assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [ids.product])).rows[0].current_stock, 9);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM prodx_payments WHERE store_id=$1 AND order_id=$2', [ids.store, firstBody.confirmedOrder.id])).rows[0].count, 1);
    } finally { await server.close(); }
  } finally { await clean(); await pool.end(); }
});
