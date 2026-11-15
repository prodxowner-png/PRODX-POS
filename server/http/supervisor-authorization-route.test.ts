import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword } from '../auth/password';
import { createApp } from './createApp';
import { registerSupervisorAuthorizationRoute } from './supervisor-authorization-route';
import type { TransactionalSqlExecutor } from '../db/transaction';

const principal = { userId: 'requester-1', organizationId: 'org-1', storeId: 'store-1', sessionId: 'session-1' };

const start = async (app: ReturnType<typeof createApp>) => {
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
};

test('supervisor authorization route issues a server-scoped token from authenticated session context', async () => {
  const secretHash = await hashPassword('correct horse battery staple');
  let transactionCalls = 0;
  const db: TransactionalSqlExecutor = {
    query: async () => {
      throw new Error('direct db.query must not be used for authorization issuance');
    },
    transaction: async (work) => {
      transactionCalls += 1;
      return work({
        query: async <T extends Record<string, unknown>>(sql: string) => {
          if (sql.includes('SELECT u.id AS "userId"')) return { rows: [{ userId: 'supervisor-1', organizationId: principal.organizationId, status: 'active', secretHash, failedAttempts: 0, lockedUntil: null }] as unknown as T[] };
          if (sql.includes('SELECT m.user_id AS "userId"')) return { rows: [{ userId: 'supervisor-1' }] as unknown as T[] };
          if (sql.includes('UPDATE prodx_user_credentials')) return { rows: [] as T[] };
          if (sql.includes('INSERT INTO prodx_supervisor_authorizations')) return { rows: [] as T[] };
          if (sql.includes('prodx_record_supervisor_authorization_event')) return { rows: [] as T[] };
          throw new Error(`Unexpected SQL in supervisor authorization transaction: ${sql}`);
        },
      });
    },
  };
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: (_context, permission) => permission === 'pos.refund',
    configureRoutes: (configuredApp) => registerSupervisorAuthorizationRoute(configuredApp, db),
  });
  const server = await start(app);
  try {
    const before = Date.now();
    const response = await fetch(`${server.baseUrl}/api/v1/authorizations/supervisor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'refund', orderId: 'order-1', supervisorUsername: 'supervisor', supervisorSecret: 'correct horse battery staple' }),
    });
    assert.equal(response.status, 201);
    assert.equal(transactionCalls, 1);
    const body = await response.json() as { authorizationToken: string; supervisorUserId: string; expiresAt: string };
    assert.equal(body.supervisorUserId, 'supervisor-1');
    assert.ok(body.authorizationToken.length >= 40);
    const expires = Date.parse(body.expiresAt);
    assert.ok(expires >= before + 119_000 && expires <= Date.now() + 121_000);
  } finally { await server.close(); }
});

test('supervisor authorization route requires void permission instead of refund permission', async () => {
  const db: TransactionalSqlExecutor = {
    query: async () => {
      throw new Error('database must not be reached when void permission is denied');
    },
    transaction: async () => {
      throw new Error('transaction must not be reached when void permission is denied');
    },
  };
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: (_context, permission) => permission === 'pos.refund',
    configureRoutes: (configuredApp) => registerSupervisorAuthorizationRoute(configuredApp, db),
  });
  const server = await start(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/authorizations/supervisor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'void',
        orderId: 'order-1',
        supervisorUsername: 'supervisor',
        supervisorSecret: 'secret',
      }),
    });
    assert.equal(response.status, 403);
  } finally { await server.close(); }
});

test('supervisor authorization route fails closed when requester lacks refund permission', async () => {
  let databaseReached = false;
  const db: TransactionalSqlExecutor = {
    query: async () => { databaseReached = true; throw new Error('database must not be reached'); },
    transaction: async () => { databaseReached = true; throw new Error('transaction must not be reached'); },
  };
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: () => false,
    configureRoutes: (configuredApp) => registerSupervisorAuthorizationRoute(configuredApp, db),
  });
  const server = await start(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/authorizations/supervisor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'refund', orderId: 'order-1', supervisorUsername: 'supervisor', supervisorSecret: 'secret' }) });
    assert.equal(response.status, 403);
    assert.equal(databaseReached, false);
  } finally { await server.close(); }
});

test('supervisor authorization route rejects malformed requests before database work', async () => {
  let databaseReached = false;
  const db: TransactionalSqlExecutor = {
    query: async () => { databaseReached = true; throw new Error('database must not be reached'); },
    transaction: async () => { databaseReached = true; throw new Error('transaction must not be reached'); },
  };
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: () => true,
    configureRoutes: (configuredApp) => registerSupervisorAuthorizationRoute(configuredApp, db),
  });
  const server = await start(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/authorizations/supervisor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'refund', orderId: '', supervisorUsername: 'supervisor', supervisorSecret: '' }) });
    assert.equal(response.status, 400);
    assert.equal(databaseReached, false);
  } finally { await server.close(); }
});
