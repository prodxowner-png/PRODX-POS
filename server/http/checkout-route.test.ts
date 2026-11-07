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
      ...validCheckoutBody(),
      idempotencyKey: 'discount-denied-1',
      items: [{ ...validCheckoutBody().items[0], discountBps: 500 }],
    }),
  });
  assert.equal(response.status, 403);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, 'DISCOUNT_NOT_AUTHORIZED');
});


const validCheckoutBody = () => {
  const zero = { amountInCents: 0, currency: 'THB' };
  const amount = { amountInCents: 1000, currency: 'THB' };
  return {
    idempotencyKey: 'checkout-validation-1',
    storeId: 'store-1',
    registerId: 'register-1',
    cashierId: 'cashier-1',
    items: [{
      lineId: 'line-1',
      product: { id: 'product-1' },
      quantity: 1,
      unitPrice: amount,
      discountBps: 0,
      lineSubtotal: amount,
      lineTax: zero,
      lineTotal: amount,
    }],
    totals: {
      grossSubtotal: amount,
      itemDiscounts: zero,
      orderDiscount: zero,
      netSubtotal: amount,
      totalTax: zero,
      grandTotal: amount,
      totalItemsCount: 1,
    },
    payments: [{
      id: 'payment-1',
      method: 'cash',
      amount,
      tenderedCash: amount,
      changeGiven: zero,
      timestamp: '2026-11-01T00:00:00.000Z',
    }],
  };
};

test('checkout rejects malformed structures and unsafe minor-unit amounts before database work', async () => {
  let databaseCalls = 0;
  const db = {
    query: async () => { databaseCalls += 1; throw new Error('database must not be reached'); },
    transaction: async () => { databaseCalls += 1; throw new Error('transaction must not be reached'); },
  } as unknown as TransactionalSqlExecutor;
  const app = createApp({
    authenticateRequest: () => ({ userId: 'cashier-1', organizationId: 'org-1', storeId: 'store-1' }),
    authorizeRequest: (_context, permission) => permission === 'pos.sell',
    configureRoutes: (configuredApp) => registerCheckoutRoute(configuredApp, db),
  });
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const valid = validCheckoutBody();
  const invalidBodies = [
    { ...valid, items: undefined },
    { ...valid, items: null },
    { ...valid, items: [null] },
    { ...valid, items: [{ ...valid.items[0], product: null }] },
    { ...valid, payments: [null] },
    { ...valid, totals: null },
    { ...valid, payments: [{ ...valid.payments[0], amount: { amountInCents: 1.5, currency: 'THB' } }] },
    { ...valid, payments: [{ ...valid.payments[0], amount: { amountInCents: Number.MAX_SAFE_INTEGER + 1, currency: 'THB' } }] },
    { ...valid, payments: [{ ...valid.payments[0], amount: { amountInCents: 1_000_000_000_000, currency: 'THB' } }] },
    { ...valid, payments: [{ ...valid.payments[0], amount: { amountInCents: '1000', currency: 'THB' } }] },
    { ...valid, items: [{ ...valid.items[0], quantity: Number.MAX_SAFE_INTEGER + 1 }] },
    { ...valid, items: [{ ...valid.items[0], quantity: 2_147_483_648 }] },
    { ...valid, items: [{ ...valid.items[0], discountBps: 10001 }] },
  ];

  try {
    for (const body of invalidBodies) {
      const httpResponse: globalThis.Response = await fetch(`http://127.0.0.1:${address.port}/api/v1/orders/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session' },
        body: JSON.stringify(body),
      });
      assert.equal(httpResponse.status, 400);
      assert.equal((await httpResponse.json()).error.code, 'CHECKOUT_VALIDATION_FAILED');
    }
    assert.equal(databaseCalls, 0, 'invalid checkout must not start a query or transaction');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
