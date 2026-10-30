import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from './createApp';
import { registerCheckoutRoute } from './checkout-route';
import type { TransactionalSqlExecutor } from '../db/transaction';

test('checkout rejects discounts when the authenticated principal lacks pos.discount', async (t) => {
  const db = {
    query: async () => { throw new Error('Checkout database must not be reached for unauthorized discounts.'); },
    transaction: async () => { throw new Error('Checkout transaction must not start for unauthorized discounts.'); },
  } as unknown as TransactionalSqlExecutor;
  const app = createApp({
    authenticateRequest: () => ({ userId: 'cashier-1', organizationId: 'org-1', storeId: 'store-1' }),
    authorizeRequest: async (_context, permission) => permission === 'pos.sell',
    configureRoutes: (configuredApp) => registerCheckoutRoute(configuredApp, db),
  });
  const server = app.listen(0);
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/orders/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session' },
    body: JSON.stringify({
      idempotencyKey: 'discount-denied-1',
      storeId: 'store-1',
      registerId: 'register-1',
      cashierId: 'cashier-1',
      items: [{ discountBps: 500 }],
      payments: [],
      totals: {},
    }),
  });
  assert.equal(response.status, 403);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, 'DISCOUNT_NOT_AUTHORIZED');
});
