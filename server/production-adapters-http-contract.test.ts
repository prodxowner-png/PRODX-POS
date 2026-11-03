import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionOrderTransactionApi } from '../src/adapters/productionOrderTransactionApi';
import { createProductionRefundApi } from '../src/adapters/productionRefundApi';
import { createProductionSyncApi } from '../src/adapters/productionSyncApi';
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

test('production sync adapter posts durable outbox command', async () => {
  const calls = mockFetch({ confirmedOrder: { id: 'ord-1', status: 'server_confirmed' }, syncedAt: '2026-10-05T15:00:00.000Z' });
  await createProductionSyncApi('token-sync', BASE_URL).syncOutboxItem({
    id: 'outbox-1', type: 'order_transaction', idempotencyKey: 'checkout-sync-1',
    payload: { idempotencyKey: 'checkout-sync-1', registerId: 'register-1', items: [], payments: [], totals: {} },
    createdAt: '2026-10-05T14:59:00.000Z', attempts: 1, syncState: 'queued',
  } as never);
  assert.equal(calls[0].url, BASE_URL + '/api/v1/sync/commands');
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer token-sync');
  assert.equal(JSON.parse(String(calls[0].init?.body)).item.idempotencyKey, 'checkout-sync-1');
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

