import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionShiftApi } from './productionShiftApi';

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('getCurrentShift returns null when the server responds 200 with JSON null (known closed shift)', async () => {
  const api = createProductionShiftApi('token-123', {
    apiBaseUrl: 'https://api.prodx.test',
    fetchImpl: async () => createJsonResponse(null, 200),
  });

  const shift = await api.getCurrentShift('store-1', 'reg-1');
  assert.equal(shift, null);
});

test('getCurrentShift returns the active shift when the server responds 200 with a shift object', async () => {
  const activeShift = {
    id: 'shift-1',
    storeId: 'store-1',
    registerId: 'reg-1',
    cashierId: 'user-1',
    cashierName: 'Alice',
    openedAt: '2026-11-27T00:00:00.000Z',
    status: 'open',
    openingFloat: { amountInCents: 10000, currency: 'THB' },
    movements: [],
  };

  const api = createProductionShiftApi('token-123', {
    apiBaseUrl: 'https://api.prodx.test',
    fetchImpl: async () => createJsonResponse(activeShift, 200),
  });

  const shift = await api.getCurrentShift('store-1', 'reg-1');
  assert.deepEqual(shift, activeShift);
});

test('getCurrentShift fails closed on non-OK HTTP status, network error, or invalid JSON', async () => {
  const serverErrorApi = createProductionShiftApi('token-123', {
    apiBaseUrl: 'https://api.prodx.test',
    fetchImpl: async () => createJsonResponse({ error: 'boom' }, 500),
  });
  await assert.rejects(() => serverErrorApi.getCurrentShift('store-1', 'reg-1'));

  const networkErrorApi = createProductionShiftApi('token-123', {
    apiBaseUrl: 'https://api.prodx.test',
    fetchImpl: async () => {
      throw new TypeError('network down');
    },
  });
  await assert.rejects(() => networkErrorApi.getCurrentShift('store-1', 'reg-1'));

  const invalidJsonApi = createProductionShiftApi('token-123', {
    apiBaseUrl: 'https://api.prodx.test',
    fetchImpl: async () => new Response('not-json', { status: 200 }),
  });
  await assert.rejects(() => invalidJsonApi.getCurrentShift('store-1', 'reg-1'));

  const missingBaseUrlApi = createProductionShiftApi('token-123', {
    apiBaseUrl: '',
    fetchImpl: async () => createJsonResponse(null, 200),
  });
  await assert.rejects(() => missingBaseUrlApi.getCurrentShift('store-1', 'reg-1'));
});
