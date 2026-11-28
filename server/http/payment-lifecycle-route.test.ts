import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResultRow } from 'pg';
import { createApp } from './createApp';
import { registerPaymentLifecycleRoute } from './payment-lifecycle-route';
import type { TransactionalSqlExecutor } from '../db/transaction';

const principal = {
  userId: 'payment-route-user',
  organizationId: 'payment-route-org',
  storeId: 'payment-route-store',
  sessionId: 'payment-route-session',
};

const start = async (app: ReturnType<typeof createApp>) => {
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())),
  };
};

test('payment lifecycle route denies callers without payment.capture before any database access', async () => {
  let databaseCalls = 0;
  const query = async <T extends QueryResultRow>() => {
    databaseCalls += 1;
    throw new Error('Unauthorized payment lifecycle requests must not access the database.');
    return { rows: [] as unknown as T[] };
  };
  const db: TransactionalSqlExecutor = {
    query,
    transaction: async (work) => {
      databaseCalls += 1;
      return work({ query });
    },
  };
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: (_context, permission) => permission !== 'payment.capture',
    configureRoutes: (configuredApp) => registerPaymentLifecycleRoute(configuredApp, db),
  });
  const server = await start(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/v1/payments/lifecycle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderId: 'order-1',
        paymentId: 'payment-1',
        idempotencyKey: 'unauthorized-payment-event',
        to: 'captured',
        provider: 'stripe',
        providerReference: 'pi_test_untrusted',
      }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json() as { error?: { code?: string } }).error?.code, 'FORBIDDEN');
    assert.equal(databaseCalls, 0);
  } finally {
    await server.close();
  }
});

test('payment lifecycle route rejects malformed provider events before opening a transaction', async () => {
  let transactionCalls = 0;
  const query = async <T extends QueryResultRow>() => ({ rows: [] as unknown as T[] });
  const db: TransactionalSqlExecutor = {
    query,
    transaction: async (work) => {
      transactionCalls += 1;
      return work({ query });
    },
  };
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: (_context, permission) => permission === 'payment.capture',
    configureRoutes: (configuredApp) => registerPaymentLifecycleRoute(configuredApp, db),
  });
  const server = await start(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/v1/payments/lifecycle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderId: 'order-1', paymentId: 'payment-1', idempotencyKey: 'malformed-event',
        to: 'settled', provider: 'stripe',
      }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { error?: { code?: string } }).error?.code, 'PAYMENT_VALIDATION_FAILED');
    assert.equal(transactionCalls, 0);
  } finally {
    await server.close();
  }
});


test('payment lifecycle route rejects client-asserted provider status until a verified provider adapter exists', async () => {
  let databaseCalls = 0;
  const query = async <T extends QueryResultRow>() => {
    databaseCalls += 1;
    return { rows: [] as unknown as T[] };
  };
  const db: TransactionalSqlExecutor = {
    query,
    transaction: async (work) => {
      databaseCalls += 1;
      return work({ query });
    },
  };
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: (_context, permission) => permission === 'payment.capture',
    configureRoutes: (configuredApp) => registerPaymentLifecycleRoute(configuredApp, db),
  });
  const server = await start(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/v1/payments/lifecycle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderId: 'order-1', paymentId: 'payment-1', idempotencyKey: 'forged-provider-event',
        to: 'captured', provider: 'stripe', providerReference: 'pi_test_unverified',
      }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json() as { error?: { code?: string } }).error?.code, 'PAYMENT_PROVIDER_NOT_CONFIGURED');
    assert.equal(databaseCalls, 0, 'unverified provider status must never reach the payment lifecycle service');
  } finally {
    await server.close();
  }
});
