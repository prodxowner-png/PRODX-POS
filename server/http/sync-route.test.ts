import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createPostgresPool, resolveConfiguredDatabaseUrl } from '../db/postgres';
import { createTransactionalPostgresExecutor } from '../db/transaction';
import { createApp } from './createApp';
import { registerSyncRoute } from './sync-route';
import type { CheckoutRequest } from '../../src/adapters/types';
import type { TransactionalSqlExecutor } from '../db/transaction';

const url = resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);
const pool = url ? createPostgresPool({ connectionString: url, max: 8 }) : null;
const db = pool ? createTransactionalPostgresExecutor(pool) : null;
// Append-only audit events are retained; each integration run owns isolated fixtures.
const ids = { org: randomUUID(), store: randomUUID(), user: randomUUID(), register: randomUUID(), shift: randomUUID(), category: randomUUID(), product: randomUUID(), payment: randomUUID() };
const runSuffix = ids.org.replaceAll('-', '').slice(0, 12);

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
      body: JSON.stringify({ item: { id: 'outbox-1', type: 'refund_transaction', idempotencyKey: 'sync-1', payload: { idempotencyKey: 'sync-1' }, createdAt: '2026-10-02T00:00:00.000Z', attempts: 0, syncState: 'queued' } }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'SYNC_COMMAND_UNSUPPORTED');
  } finally {
    await server.close();
  }
});

test('sync route enforces RBAC permissions and payload validation for shift_movement and stock_adjustment before database work', async () => {
  let allowedPermissions = new Set<string>(['pos.sell']);
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: (_context, permission) => allowedPermissions.has(permission),
    configureRoutes: (configuredApp) => registerSyncRoute(configuredApp, unreachableDb),
  });
  const server = await start(app);
  try {
    // 1. shift_movement denied without cash.shift.movement permission
    const deniedShift = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        item: {
          id: 'outbox-shift-deny',
          type: 'shift_movement',
          idempotencyKey: 'shift-deny-1',
          payload: {
            idempotencyKey: 'shift-deny-1',
            shiftId: 'shift-1',
            type: 'paid_in',
            amount: { amountInCents: 1000, currency: 'THB' },
            reason: 'Petty cash',
          },
          createdAt: '2026-10-02T00:00:00.000Z',
          attempts: 0,
          syncState: 'queued',
        },
      }),
    });
    assert.equal(deniedShift.status, 403);
    assert.equal((await deniedShift.json()).error.code, 'FORBIDDEN');

    // 2. stock_adjustment denied without inventory.adjust permission
    const deniedStock = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        item: {
          id: 'outbox-stock-deny',
          type: 'stock_adjustment',
          idempotencyKey: 'stock-deny-1',
          payload: {
            idempotencyKey: 'stock-deny-1',
            productIds: ['prod-1'],
            quantityDelta: 5,
            reason: 'purchase_received',
          },
          createdAt: '2026-10-02T00:00:00.000Z',
          attempts: 0,
          syncState: 'queued',
        },
      }),
    });
    assert.equal(deniedStock.status, 403);
    assert.equal((await deniedStock.json()).error.code, 'FORBIDDEN');

    // 3. Grant permissions and verify malformed payloads and cross-store mismatches are rejected before DB work
    allowedPermissions = new Set(['pos.sell', 'cash.shift.movement', 'inventory.adjust']);

    for (const invalidShiftPayload of [
      { idempotencyKey: 'shift-bad-1', shiftId: 'shift-1', type: 'cash_sale', amount: { amountInCents: 1000, currency: 'THB' }, reason: 'Server-only type' },
      { idempotencyKey: 'shift-bad-1', shiftId: 'shift-1', type: 'opening_float', amount: { amountInCents: 1000, currency: 'THB' }, reason: 'Server-only type' },
      { idempotencyKey: 'shift-bad-1', shiftId: 'shift-1', type: 'paid_out', amount: { amountInCents: 0, currency: 'THB' }, reason: 'Zero amount' },
      { idempotencyKey: 'shift-bad-1', shiftId: 'shift-1', type: 'paid_out', amount: { amountInCents: 500, currency: 'THB' }, reason: '' },
    ]) {
      const res = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          item: {
            id: 'outbox-shift-bad',
            type: 'shift_movement',
            idempotencyKey: 'shift-bad-1',
            payload: invalidShiftPayload,
            createdAt: '2026-10-02T00:00:00.000Z',
            attempts: 0,
            syncState: 'queued',
          },
        }),
      });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error.code, 'SYNC_PAYLOAD_INVALID');
    }

    const crossStoreShift = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        item: {
          id: 'outbox-shift-cross-store',
          type: 'shift_movement',
          idempotencyKey: 'shift-cross-1',
          payload: {
            idempotencyKey: 'shift-cross-1',
            storeId: 'other-store',
            shiftId: 'shift-1',
            type: 'paid_in',
            amount: { amountInCents: 1000, currency: 'THB' },
            reason: 'Cross store attempt',
          },
          createdAt: '2026-10-02T00:00:00.000Z',
          attempts: 0,
          syncState: 'queued',
        },
      }),
    });
    assert.equal(crossStoreShift.status, 403);
    assert.equal((await crossStoreShift.json()).error.code, 'FORBIDDEN');

    for (const invalidStockPayload of [
      { idempotencyKey: 'stock-bad-1', productIds: [], quantityDelta: 2, reason: 'purchase_received' },
      { idempotencyKey: 'stock-bad-1', productIds: ['prod-1'], quantityDelta: 0, reason: 'purchase_received' },
      { idempotencyKey: 'stock-bad-1', productIds: ['prod-1'], quantityDelta: -1, reason: 'sale_deduction' },
    ]) {
      const res = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          item: {
            id: 'outbox-stock-bad',
            type: 'stock_adjustment',
            idempotencyKey: 'stock-bad-1',
            payload: invalidStockPayload,
            createdAt: '2026-10-02T00:00:00.000Z',
            attempts: 0,
            syncState: 'queued',
          },
        }),
      });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error.code, 'SYNC_PAYLOAD_INVALID');
    }

    const crossStoreStock = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        item: {
          id: 'outbox-stock-cross-store',
          type: 'stock_adjustment',
          idempotencyKey: 'stock-cross-1',
          payload: {
            idempotencyKey: 'stock-cross-1',
            storeId: 'other-store',
            productIds: ['prod-1'],
            quantityDelta: 2,
            reason: 'purchase_received',
          },
          createdAt: '2026-10-02T00:00:00.000Z',
          attempts: 0,
          syncState: 'queued',
        },
      }),
    });
    assert.equal(crossStoreStock.status, 403);
    assert.equal((await crossStoreStock.json()).error.code, 'FORBIDDEN');
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
  const replayLookupDb: TransactionalSqlExecutor = {
    query: async () => ({ rows: [] }),
    transaction: async (work) => work({ query: async () => ({ rows: [] }) }),
  };
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: (_context, permission) => permission === 'pos.sell',
    configureRoutes: (configuredApp) => registerSyncRoute(configuredApp, replayLookupDb),
  });
  const server = await start(app);
  try {
    const validPayload = request('sync-discount-1');
    const payload = { ...validPayload, items: validPayload.items.map((line) => ({ ...line, discountBps: 500 })) };
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
  idempotencyKey: key, storeId: ids.store, registerId: ids.register, cashierId: ids.user,
  items: [{ lineId: 'sync-line', product: { id: ids.product, storeId: ids.store, sku: `SYNC-${runSuffix}`, barcode: `SYNC-${runSuffix}`, name: 'Sync Product', categoryId: ids.category, price: { amountInCents: 1000, currency: 'THB' }, costPrice: { amountInCents: 500, currency: 'THB' }, taxRateBps: 0, currentStock: 10, reorderPoint: 1, unitOfMeasure: 'each' }, quantity: 1, unitPrice: { amountInCents: 1000, currency: 'THB' }, discountBps: 0, lineSubtotal: { amountInCents: 1000, currency: 'THB' }, lineTax: { amountInCents: 0, currency: 'THB' }, lineTotal: { amountInCents: 1000, currency: 'THB' } }],
  totals: { grossSubtotal: { amountInCents: 1000, currency: 'THB' }, itemDiscounts: { amountInCents: 0, currency: 'THB' }, orderDiscount: { amountInCents: 0, currency: 'THB' }, netSubtotal: { amountInCents: 1000, currency: 'THB' }, totalTax: { amountInCents: 0, currency: 'THB' }, grandTotal: { amountInCents: 1000, currency: 'THB' }, totalItemsCount: 1 },
  payments: [{ id: ids.payment, method: 'cash', amount: { amountInCents: 1000, currency: 'THB' }, tenderedCash: { amountInCents: 1000, currency: 'THB' }, changeGiven: { amountInCents: 0, currency: 'THB' }, timestamp: '2026-10-05T00:00:00.000Z' }],
});

test('production sync HTTP path commits order_transaction, shift_movement, and stock_adjustment once and returns cached result on replay with conflict protection', async (t) => {
  if (!pool || !db) { t.skip('DATABASE_URL not configured'); return; }

  try {
    await pool.query('INSERT INTO prodx_organizations(id,code,name) VALUES($1,$2,$3)', [ids.org, `sync-http-${runSuffix}`, 'Sync HTTP']);
    await pool.query('INSERT INTO prodx_stores(id,organization_id,code,name,business_timezone) VALUES($1,$2,$3,$4,$5)', [ids.store, ids.org, `sync-store-${runSuffix}`, 'Sync Store', 'Asia/Bangkok']);
    await pool.query('INSERT INTO prodx_users(id,organization_id,username,display_name) VALUES($1,$2,$3,$4)', [ids.user, ids.org, `sync-user-${runSuffix}`, 'Sync User']);
    await pool.query('INSERT INTO prodx_store_memberships(organization_id,store_id,user_id) VALUES($1,$2,$3)', [ids.org, ids.store, ids.user]);
    await pool.query('INSERT INTO prodx_registers(id,organization_id,store_id,code,name) VALUES($1,$2,$3,$4,$5)', [ids.register, ids.org, ids.store, `SYNC-R1-${runSuffix}`, 'Sync Register']);
    await pool.query("INSERT INTO prodx_shifts(id,organization_id,store_id,register_id,cashier_id,opening_float_amount,currency) VALUES($1,$2,$3,$4,$5,0,'THB')", [ids.shift, ids.org, ids.store, ids.register, ids.user]);
    await pool.query('INSERT INTO prodx_categories(id,organization_id,store_id,name,slug) VALUES($1,$2,$3,$4,$5)', [ids.category, ids.org, ids.store, 'Sync Category', `sync-category-${runSuffix}`]);
    await pool.query("INSERT INTO prodx_products(id,organization_id,store_id,category_id,sku,barcode,name,price_amount,cost_price_amount,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure) VALUES($1,$2,$3,$4,$5,$5,'Sync Product',10.00,5.00,'THB',0,10,1,'each')", [ids.product, ids.org, ids.store, ids.category, `SYNC-${runSuffix}`]);
    let discountAuthorized = true;
    const app = createApp({
      authenticateRequest: () => ({ userId: ids.user, organizationId: ids.org, storeId: ids.store, sessionId: 'sync-http-session' }),
      authorizeRequest: (_context, permission) =>
        permission === 'pos.sell' ||
        permission === 'cash.shift.movement' ||
        permission === 'inventory.adjust' ||
        (permission === 'pos.discount' && discountAuthorized),
      configureRoutes: (configuredApp) => registerSyncRoute(configuredApp, db),
    });
    const server = await start(app);
    try {
      // 1. order_transaction: commit (201) -> replay (200) -> payload mismatch conflict (409)
      const basePayload = request(`offline-sync-${runSuffix}`);
      const discountedPayload: CheckoutRequest = {
        ...basePayload,
        items: basePayload.items.map((line) => ({ ...line, discountBps: 500 })),
        totals: { ...basePayload.totals, itemDiscounts: { amountInCents: 50, currency: 'THB' }, netSubtotal: { amountInCents: 950, currency: 'THB' }, grandTotal: { amountInCents: 950, currency: 'THB' } },
        payments: basePayload.payments.map((payment) => ({ ...payment, amount: { amountInCents: 950, currency: 'THB' }, tenderedCash: { amountInCents: 950, currency: 'THB' }, changeGiven: { amountInCents: 0, currency: 'THB' } })),
      };
      const item = { id: `offline-sync-${runSuffix}`, type: 'order_transaction' as const, idempotencyKey: `offline-sync-${runSuffix}`, payload: discountedPayload, createdAt: '2026-10-05T00:00:00.000Z', attempts: 0, syncState: 'queued' as const };
      const first = await fetch(`${server.baseUrl}/api/v1/sync/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item }) });
      assert.equal(first.status, 201);
      const firstBody = await first.json() as { commandType: string; confirmedEntityId: string; confirmedOrder: { id: string }; serverConfirmed: boolean; idempotencyCached: boolean };
      assert.equal(firstBody.commandType, 'order_transaction');
      assert.equal(firstBody.confirmedEntityId, firstBody.confirmedOrder.id);
      assert.equal(firstBody.serverConfirmed, true); assert.equal(firstBody.idempotencyCached, false);
      discountAuthorized = false;
      const replay = await fetch(`${server.baseUrl}/api/v1/sync/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: { ...item, attempts: 1 } }) });
      assert.equal(replay.status, 200);
      const replayBody = await replay.json() as { confirmedOrder: { id: string }; serverConfirmed: boolean; idempotencyCached: boolean };
      assert.equal(replayBody.serverConfirmed, true); assert.equal(replayBody.idempotencyCached, true); assert.equal(replayBody.confirmedOrder.id, firstBody.confirmedOrder.id);
      const changedPayload = { ...discountedPayload, notes: 'altered payload must not replay' };
      const changedReplay = await fetch(`${server.baseUrl}/api/v1/sync/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: { ...item, payload: changedPayload, attempts: 2 } }) });
      assert.equal(changedReplay.status, 409);
      assert.equal((await changedReplay.json()).error.code, 'CHECKOUT_CONFLICT');
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM prodx_orders WHERE store_id=$1 AND idempotency_key=$2', [ids.store, item.idempotencyKey])).rows[0].count, 1);
      assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [ids.product])).rows[0].current_stock, 9);
      assert.equal((await pool.query('SELECT grand_total_amount::text FROM prodx_orders WHERE id=$1', [firstBody.confirmedOrder.id])).rows[0].grand_total_amount, '9.50');
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM prodx_payments WHERE store_id=$1 AND order_id=$2', [ids.store, firstBody.confirmedOrder.id])).rows[0].count, 1);

      // 2. shift_movement: commit (201) -> replay (200) -> payload mismatch conflict (409)
      const shiftIdemKey = `offline-shift-mov-${runSuffix}`;
      const shiftPayload = {
        idempotencyKey: shiftIdemKey,
        storeId: ids.store,
        shiftId: ids.shift,
        type: 'paid_in' as const,
        amount: { amountInCents: 2500, currency: 'THB' },
        reason: 'Offline drawer replenishment',
        performedByUserId: ids.user,
      };
      const shiftItem = {
        id: `outbox-shift-${runSuffix}`,
        type: 'shift_movement' as const,
        idempotencyKey: shiftIdemKey,
        payload: shiftPayload,
        createdAt: '2026-10-05T00:01:00.000Z',
        attempts: 0,
        syncState: 'queued' as const,
      };
      const shiftFirst = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ item: shiftItem }),
      });
      assert.equal(shiftFirst.status, 201);
      const shiftFirstBody = await shiftFirst.json() as {
        commandType: string;
        confirmedEntityId: string;
        confirmedMovement: { id: string; shiftId: string; type: string; amount: { amountInCents: number; currency: string }; reason: string };
        serverConfirmed: boolean;
        idempotencyCached: boolean;
      };
      assert.equal(shiftFirstBody.commandType, 'shift_movement');
      assert.equal(shiftFirstBody.serverConfirmed, true);
      assert.equal(shiftFirstBody.idempotencyCached, false);
      assert.equal(shiftFirstBody.confirmedEntityId, shiftFirstBody.confirmedMovement.id);
      assert.equal(shiftFirstBody.confirmedMovement.amount.amountInCents, 2500);

      const shiftReplay = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ item: { ...shiftItem, attempts: 1 } }),
      });
      assert.equal(shiftReplay.status, 200);
      const shiftReplayBody = await shiftReplay.json() as typeof shiftFirstBody;
      assert.equal(shiftReplayBody.serverConfirmed, true);
      assert.equal(shiftReplayBody.idempotencyCached, true);
      assert.equal(shiftReplayBody.confirmedEntityId, shiftFirstBody.confirmedEntityId);

      const shiftConflict = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          item: {
            ...shiftItem,
            attempts: 2,
            payload: { ...shiftPayload, amount: { amountInCents: 9900, currency: 'THB' } },
          },
        }),
      });
      assert.equal(shiftConflict.status, 409);
      assert.equal((await shiftConflict.json()).error.code, 'SHIFT_CONFLICT');

      // Closed-shift movement attempt via sync route returns 409 SHIFT_CONFLICT
      const closedShiftId = randomUUID();
      await pool.query(
        "INSERT INTO prodx_shifts(id,organization_id,store_id,register_id,cashier_id,status,closed_at,opening_float_amount,actual_counted_cash_amount,currency) VALUES($1,$2,$3,$4,$5,'closed',CURRENT_TIMESTAMP,0,0,'THB')",
        [closedShiftId, ids.org, ids.store, ids.register, ids.user],
      );
      const closedShiftKey = `offline-shift-closed-${runSuffix}`;
      const closedShiftRes = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          item: {
            id: `outbox-shift-closed-${runSuffix}`,
            type: 'shift_movement',
            idempotencyKey: closedShiftKey,
            payload: {
              idempotencyKey: closedShiftKey,
              storeId: ids.store,
              shiftId: closedShiftId,
              type: 'paid_out',
              amount: { amountInCents: 500, currency: 'THB' },
              reason: 'Movement against closed shift',
            },
            createdAt: '2026-10-05T00:01:30.000Z',
            attempts: 0,
            syncState: 'queued',
          },
        }),
      });
      assert.equal(closedShiftRes.status, 409);
      assert.equal((await closedShiftRes.json()).error.code, 'SHIFT_CONFLICT');

      assert.equal(
        (await pool.query("SELECT count(*)::int AS count FROM prodx_cash_movements WHERE shift_id=$1 AND type='paid_in'", [ids.shift])).rows[0].count,
        1,
      );
      assert.equal(
        (await pool.query("SELECT count(*)::int AS count FROM prodx_audit_log WHERE store_id=$1 AND action='cash_movement_recorded'", [ids.store])).rows[0].count,
        1,
      );

      // 3. stock_adjustment: commit (201) -> replay (200) -> payload mismatch conflict (409) -> negative stock rejection (409)
      const stockIdemKey = `offline-stock-adj-${runSuffix}`;
      const stockPayload = {
        idempotencyKey: stockIdemKey,
        storeId: ids.store,
        productIds: [ids.product],
        quantityDelta: -2,
        reason: 'damaged_write_off' as const,
        notes: 'Offline damaged write-off',
        requesterUserId: ids.user,
      };
      const stockItem = {
        id: `outbox-stock-${runSuffix}`,
        type: 'stock_adjustment' as const,
        idempotencyKey: stockIdemKey,
        payload: stockPayload,
        createdAt: '2026-10-05T00:02:00.000Z',
        attempts: 0,
        syncState: 'queued' as const,
      };
      const stockFirst = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ item: stockItem }),
      });
      assert.equal(stockFirst.status, 201);
      const stockFirstBody = await stockFirst.json() as {
        commandType: string;
        confirmedEntityId: string;
        confirmedAdjustment: { adjustmentId: string; entries: Array<{ resulting_stock: number; quantity_delta: number }> };
        serverConfirmed: boolean;
        idempotencyCached: boolean;
      };
      assert.equal(stockFirstBody.commandType, 'stock_adjustment');
      assert.equal(stockFirstBody.serverConfirmed, true);
      assert.equal(stockFirstBody.idempotencyCached, false);
      assert.equal(stockFirstBody.confirmedEntityId, stockFirstBody.confirmedAdjustment.adjustmentId);
      assert.equal(stockFirstBody.confirmedAdjustment.entries.length, 1);
      assert.equal(stockFirstBody.confirmedAdjustment.entries[0].resulting_stock, 7);

      const stockReplay = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ item: { ...stockItem, attempts: 1 } }),
      });
      assert.equal(stockReplay.status, 200);
      const stockReplayBody = await stockReplay.json() as typeof stockFirstBody;
      assert.equal(stockReplayBody.serverConfirmed, true);
      assert.equal(stockReplayBody.idempotencyCached, true);
      assert.equal(stockReplayBody.confirmedEntityId, stockFirstBody.confirmedEntityId);
      assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [ids.product])).rows[0].current_stock, 7);

      const stockConflict = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          item: {
            ...stockItem,
            attempts: 2,
            payload: { ...stockPayload, quantityDelta: -5 },
          },
        }),
      });
      assert.equal(stockConflict.status, 409);
      assert.equal((await stockConflict.json()).error.code, 'INVENTORY_ADJUSTMENT_CONFLICT');

      const negativeStockKey = `offline-stock-neg-${runSuffix}`;
      const negativeStockRes = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          item: {
            id: `outbox-stock-neg-${runSuffix}`,
            type: 'stock_adjustment',
            idempotencyKey: negativeStockKey,
            payload: {
              idempotencyKey: negativeStockKey,
              storeId: ids.store,
              productIds: [ids.product],
              quantityDelta: -50,
              reason: 'audit_count_adjustment',
            },
            createdAt: '2026-10-05T00:03:00.000Z',
            attempts: 0,
            syncState: 'queued',
          },
        }),
      });
      assert.equal(negativeStockRes.status, 409);
      assert.equal((await negativeStockRes.json()).error.code, 'INVENTORY_ADJUSTMENT_CONFLICT');
      assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [ids.product])).rows[0].current_stock, 7);
      assert.equal(
        (await pool.query("SELECT count(*)::int AS count FROM prodx_audit_log WHERE store_id=$1 AND action='inventory_adjustment_committed'", [ids.store])).rows[0].count,
        1,
      );
    } finally { await server.close(); }
  } finally { await pool.end(); }
});


test('sync route rejects malformed checkout payloads before database or idempotency work', async () => {
  let databaseCalls = 0;
  const noDatabase: TransactionalSqlExecutor = {
    query: async () => { databaseCalls += 1; throw new Error('database must not be reached'); },
    transaction: async () => { databaseCalls += 1; throw new Error('transaction must not be reached'); },
  };
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: (_context, permission) => permission === 'pos.sell',
    configureRoutes: (configuredApp) => registerSyncRoute(configuredApp, noDatabase),
  });
  const server = await start(app);
  const valid = request('sync-validation-1');
  const invalidPayloads = [
    { ...valid, items: undefined },
    { ...valid, items: null },
    { ...valid, items: [null] },
    { ...valid, items: [{ ...valid.items[0], product: null }] },
    { ...valid, payments: [null] },
    { ...valid, totals: null },
    { ...valid, payments: [{ ...valid.payments[0], amount: { amountInCents: 1.25, currency: 'THB' } }] },
    { ...valid, payments: [{ ...valid.payments[0], amount: { amountInCents: Number.MAX_SAFE_INTEGER + 1, currency: 'THB' } }] },
    { ...valid, payments: [{ ...valid.payments[0], amount: { amountInCents: 1_000_000_000_000, currency: 'THB' } }] },
    { ...valid, payments: [{ ...valid.payments[0], amount: { amountInCents: '1000', currency: 'THB' } }] },
    { ...valid, items: [{ ...valid.items[0], quantity: Number.MAX_SAFE_INTEGER + 1 }] },
    { ...valid, items: [{ ...valid.items[0], quantity: 2_147_483_648 }] },
    { ...valid, items: [{ ...valid.items[0], discountBps: 10001 }] },
  ];

  try {
    for (const payload of invalidPayloads) {
      const item = {
        id: 'sync-validation-command',
        type: 'order_transaction' as const,
        idempotencyKey: 'sync-validation-1',
        payload,
        createdAt: '2026-11-01T00:00:00.000Z',
        attempts: 0,
        syncState: 'queued' as const,
      };
      const response = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ item }),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'SYNC_PAYLOAD_INVALID');
    }

    const malformedMetadata = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        item: {
          id: 'sync-invalid-metadata',
          type: 'order_transaction',
          idempotencyKey: 123,
          payload: { idempotencyKey: 123 },
          createdAt: 'not-a-date',
          attempts: 0,
          syncState: 'queued',
        },
      }),
    });
    assert.equal(malformedMetadata.status, 400);
    assert.equal(databaseCalls, 0, 'invalid outbox commands must not start a query or transaction');
  } finally {
    await server.close();
  }
});

test('offline replay rejects over-threshold discount without supervisor authorization', async () => {
  const base = request('offline-over-threshold');
  const payload: CheckoutRequest = {
    ...base,
    items: [{ ...base.items[0], discountBps: 1600, lineSubtotal: { amountInCents: 840, currency: 'THB' }, lineTotal: { amountInCents: 840, currency: 'THB' } }],
    totals: { grossSubtotal: { amountInCents: 1000, currency: 'THB' }, itemDiscounts: { amountInCents: 160, currency: 'THB' }, orderDiscount: { amountInCents: 0, currency: 'THB' }, netSubtotal: { amountInCents: 840, currency: 'THB' }, totalTax: { amountInCents: 0, currency: 'THB' }, grandTotal: { amountInCents: 840, currency: 'THB' }, totalItemsCount: 1 },
    payments: [{ ...base.payments[0], amount: { amountInCents: 840, currency: 'THB' }, tenderedCash: { amountInCents: 840, currency: 'THB' } }],
  };
  const queries: string[] = [];
  const scopedDb: TransactionalSqlExecutor = {
    query: async () => { throw new Error('direct query must not be used'); },
    transaction: async (work) => work({ query: async <T extends Record<string, unknown>>(sql: string) => {
      queries.push(sql);
      if (sql.startsWith('SELECT * FROM prodx_orders')) return { rows: [] as T[] };
      if (sql.includes('FROM prodx_shifts')) return { rows: [{ id: 'shift-1' }] as unknown as T[] };
      if (sql.includes('FROM prodx_products WHERE')) return { rows: [{ id: ids.product, store_id: ids.store, price_amount: '10.00', currency: 'THB', tax_rate_bps: 0, current_stock: 10, active: true }] as unknown as T[] };
      if (sql.includes('FROM prodx_discount_policies')) return { rows: [{ require_supervisor_approval: true, max_discount_without_approval_bps: 1500 }] as unknown as T[] };
      return { rows: [] as T[] };
    } }),
  };
  const testPrincipal = { userId: ids.user, organizationId: ids.org, storeId: ids.store, sessionId: 'session-1' };
  const app = createApp({
    authenticateRequest: () => testPrincipal,
    authorizeRequest: (_context, permission) => permission === 'pos.sell' || permission === 'pos.discount',
    configureRoutes: (configuredApp) => registerSyncRoute(configuredApp, scopedDb),
  });
  const server = await start(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/sync/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item: { id: 'outbox-over-threshold', type: 'order_transaction', idempotencyKey: payload.idempotencyKey, payload, createdAt: '2026-11-01T00:00:00.000Z', attempts: 1, syncState: 'queued' } }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'DISCOUNT_SUPERVISOR_APPROVAL_REQUIRED');
    assert.ok(queries.some((sql) => sql.includes('FROM prodx_discount_policies')));
    assert.equal(queries.some((sql) => sql.startsWith('INSERT INTO prodx_orders')), false);
  } finally { await server.close(); }
});
