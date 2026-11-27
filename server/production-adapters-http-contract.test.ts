import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionOrderTransactionApi } from '../src/adapters/productionOrderTransactionApi';
import { createProductionRefundApi } from '../src/adapters/productionRefundApi';
import { createProductionSyncApi, SyncApiError } from '../src/adapters/productionSyncApi';
import { createProductionAuditApi } from '../src/adapters/productionAuditApi';
import { createProductionOrderReadApi } from '../src/adapters/productionOrderReadApi';
import { createProductionInventoryAdjustmentApi } from '../src/adapters/productionInventoryAdjustmentApi';

const BASE_URL = 'https://pos.example.test';
const originalFetch = globalThis.fetch;
function mockFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return calls;
}
test.afterEach(() => { globalThis.fetch = originalFetch; });

test('production checkout adapter sends authenticated HTTP request', async () => {
  const calls = mockFetch({ order: { id: 'ord-1', status: 'server_confirmed' }, serverConfirmed: true });
  await createProductionOrderTransactionApi('token-123', BASE_URL).createOrder({
    idempotencyKey: 'checkout-1', storeId: 'store-1', registerId: 'register-1', cashierId: 'cashier-1',
    items: [], payments: [], totals: {} as never,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, BASE_URL + '/api/v1/orders/checkout');
  assert.equal(calls[0].init?.method, 'POST');
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer token-123');
});

test('production checkout adapter fails closed without token', async () => {
  const calls = mockFetch({ ok: true });
  await assert.rejects(
    createProductionOrderTransactionApi('', BASE_URL).createOrder({
      idempotencyKey: 'checkout-2', storeId: 'store-1', registerId: 'register-1', cashierId: 'cashier-1',
      items: [], payments: [], totals: {} as never,
    }),
    /Authenticated session token is required/,
  );
  assert.equal(calls.length, 0);
});

test('production sync adapter posts durable outbox command for order_transaction, shift_movement, and stock_adjustment', async () => {
  const calls = mockFetch({ confirmedOrder: { id: 'ord-1', status: 'server_confirmed' }, syncedAt: '2026-10-05T15:00:00.000Z' });
  await createProductionSyncApi('token-sync', BASE_URL).syncOutboxItem({
    id: 'outbox-1', type: 'order_transaction', idempotencyKey: 'checkout-sync-1',
    payload: { idempotencyKey: 'checkout-sync-1', registerId: 'register-1', items: [], payments: [], totals: {} },
    createdAt: '2026-10-05T14:59:00.000Z', attempts: 1, syncState: 'queued',
  } as never);
  assert.equal(calls[0].url, BASE_URL + '/api/v1/sync/commands');
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer token-sync');
  assert.equal(JSON.parse(String(calls[0].init?.body)).item.idempotencyKey, 'checkout-sync-1');

  const shiftCalls = mockFetch({
    commandType: 'shift_movement',
    confirmedEntityId: 'mov-1',
    confirmedMovement: { id: 'mov-1', shiftId: 'shift-1', type: 'paid_in', amount: { amountInCents: 2500, currency: 'THB' }, reason: 'Float top-up', performedByUserId: 'user-1', timestamp: '2026-10-05T15:01:00.000Z' },
    syncedAt: '2026-10-05T15:01:00.000Z',
    serverConfirmed: true,
    idempotencyCached: false,
  });
  const shiftResult = await createProductionSyncApi('token-sync', BASE_URL).syncOutboxItem({
    id: 'outbox-shift-1', type: 'shift_movement', idempotencyKey: 'shift-sync-1',
    payload: { idempotencyKey: 'shift-sync-1', shiftId: 'shift-1', type: 'paid_in', amount: { amountInCents: 2500, currency: 'THB' }, reason: 'Float top-up' },
    createdAt: '2026-10-05T15:00:30.000Z', attempts: 1, syncState: 'queued',
  });
  assert.equal(shiftCalls[0].url, BASE_URL + '/api/v1/sync/commands');
  assert.equal(shiftResult.commandType, 'shift_movement');
  assert.equal(shiftResult.confirmedEntityId, 'mov-1');

  const stockCalls = mockFetch({
    commandType: 'stock_adjustment',
    confirmedEntityId: 'adj-1',
    confirmedAdjustment: { adjustmentId: 'adj-1', entries: [] },
    syncedAt: '2026-10-05T15:02:00.000Z',
    serverConfirmed: true,
    idempotencyCached: false,
  });
  const stockResult = await createProductionSyncApi('token-sync', BASE_URL).syncOutboxItem({
    id: 'outbox-stock-1', type: 'stock_adjustment', idempotencyKey: 'stock-sync-1',
    payload: { idempotencyKey: 'stock-sync-1', productIds: ['prod-1'], quantityDelta: -2, reason: 'damaged_write_off' },
    createdAt: '2026-10-05T15:01:30.000Z', attempts: 1, syncState: 'queued',
  });
  assert.equal(stockCalls[0].url, BASE_URL + '/api/v1/sync/commands');
  assert.equal(stockResult.commandType, 'stock_adjustment');
  assert.equal(stockResult.confirmedEntityId, 'adj-1');
});

test('production sync adapter throws typed SyncApiError with status, code, and retryability', async () => {
  mockFetch({ error: { code: 'CHECKOUT_CONFLICT', message: 'Duplicate conflict', requestId: 'req-409' } }, 409);
  await assert.rejects(
    createProductionSyncApi('token-sync', BASE_URL).syncOutboxItem({
      id: 'outbox-409', type: 'order_transaction', idempotencyKey: 'checkout-sync-409',
      payload: {}, createdAt: '2026-10-05T14:59:00.000Z', attempts: 1, syncState: 'queued',
    } as never),
    (error: unknown) =>
      error instanceof SyncApiError &&
      error.status === 409 &&
      error.code === 'CHECKOUT_CONFLICT' &&
      error.requestId === 'req-409' &&
      error.retryable === false,
  );

  mockFetch({ error: { code: 'INVENTORY_ADJUSTMENT_CONFLICT', message: 'Negative stock rejected', requestId: 'req-stock-409' } }, 409);
  await assert.rejects(
    createProductionSyncApi('token-sync', BASE_URL).syncOutboxItem({
      id: 'outbox-stock-409', type: 'stock_adjustment', idempotencyKey: 'stock-sync-409',
      payload: {}, createdAt: '2026-10-05T14:59:00.000Z', attempts: 1, syncState: 'queued',
    } as never),
    (error: unknown) =>
      error instanceof SyncApiError &&
      error.status === 409 &&
      error.code === 'INVENTORY_ADJUSTMENT_CONFLICT' &&
      error.requestId === 'req-stock-409' &&
      error.retryable === false,
  );

  mockFetch({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Upstream busy', requestId: 'req-503' } }, 503);
  await assert.rejects(
    createProductionSyncApi('token-sync', BASE_URL).syncOutboxItem({
      id: 'outbox-503', type: 'order_transaction', idempotencyKey: 'checkout-sync-503',
      payload: {}, createdAt: '2026-10-05T14:59:00.000Z', attempts: 1, syncState: 'queued',
    } as never),
    (error: unknown) =>
      error instanceof SyncApiError &&
      error.status === 503 &&
      error.code === 'SERVICE_UNAVAILABLE' &&
      error.requestId === 'req-503' &&
      error.retryable === true,
  );
});

test('production refund adapter requires supervisor authorization', async () => {
  const calls = mockFetch({ ok: true });
  await assert.rejects(
    createProductionRefundApi('token-refund', BASE_URL).refund({
      orderId: 'ord-1', refundAmount: { amountInCents: 1000, currency: 'THB' }, reason: 'return',
      refundMethod: 'cash', itemsToRestock: [], idempotencyKey: 'refund-1', supervisorAuthorizationToken: '',
    }),
    /Server supervisor authorization is required/,
  );
  assert.equal(calls.length, 0);
});

test('production refund adapter forwards idempotency and supervisor authorization', async () => {
  const calls = mockFetch({ success: true, refundId: 'refund-1', orderId: 'ord-1', status: 'refunded',
    refundedAmount: { amountInCents: 1000, currency: 'THB' }, message: 'Refund committed.', idempotencyCached: false });
  await createProductionRefundApi('token-refund', BASE_URL).refund({
    orderId: 'ord-1', refundAmount: { amountInCents: 1000, currency: 'THB' }, reason: 'return',
    refundMethod: 'cash', itemsToRestock: [], idempotencyKey: 'refund-1', supervisorAuthorizationToken: 'grant-1',
  });
  assert.equal(calls[0].url, BASE_URL + '/api/v1/orders/refund');
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer token-refund');
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.idempotencyKey, 'refund-1');
  assert.equal(body.supervisorAuthorizationToken, 'grant-1');
});

test('production audit, order-read, and inventory-adjustment adapters fail closed without token', async () => {
  const calls = mockFetch([]);
  await assert.rejects(
    createProductionAuditApi('   ', BASE_URL).getLogs('store-1'),
    /Authenticated session token is required/,
  );
  await assert.rejects(
    createProductionOrderReadApi('', BASE_URL).getOrders('store-1'),
    /Authenticated session token is required/,
  );
  await assert.rejects(
    createProductionInventoryAdjustmentApi('', BASE_URL).adjustStock('store-1', 'prod-1', 5, 'audit_count_adjustment', 'user-1'),
    /Authenticated session token is required/,
  );
  assert.equal(calls.length, 0);
});



test('production order read adapter requests store-wide bounded pages without client-supplied register or store scope', async () => {
  const calls = mockFetch([]);
  await createProductionOrderReadApi('token-orders', BASE_URL).getOrders('store-client-hint', 200, undefined, {
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-11-20T23:59:59.999Z',
    offset: 400,
  });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/api/v1/orders');
  assert.equal(url.searchParams.get('limit'), '200');
  assert.equal(url.searchParams.get('offset'), '400');
  assert.equal(url.searchParams.get('from'), '2026-10-01T00:00:00.000Z');
  assert.equal(url.searchParams.get('to'), '2026-11-20T23:59:59.999Z');
  assert.equal(url.searchParams.has('storeId'), false);
  assert.equal(url.searchParams.has('registerId'), false);
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer token-orders');
});
