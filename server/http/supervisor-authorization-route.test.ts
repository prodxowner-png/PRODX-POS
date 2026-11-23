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
          if (sql.includes('prodx_supervisor_find_credential') || sql.includes('prodx_auth_find_supervisor_credential')) return { rows: [{ userId: 'supervisor-1', organizationId: principal.organizationId, status: 'active', secretHash, failedAttempts: 0, lockedUntil: null }] as unknown as T[] };
          if (sql.includes('SELECT m.user_id AS "userId"')) return { rows: [{ userId: 'supervisor-1' }] as unknown as T[] };
          if (sql.includes('prodx_supervisor_record_failed_attempt') || sql.includes('prodx_auth_record_failed_attempt')) return { rows: [] as T[] };
          if (sql.includes('prodx_supervisor_reset_failed_attempts') || sql.includes('prodx_auth_reset_failed_attempts')) return { rows: [] as T[] };
          if (sql.includes('INSERT INTO prodx_supervisor_authorizations')) return { rows: [] as T[] };
          if (sql.includes('prodx_record_supervisor_authorization_event') || sql.includes('prodx_record_security_audit_event')) return { rows: [] as T[] };
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
    const oversized = await fetch(`${server.baseUrl}/api/v1/authorizations/supervisor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'refund', orderId: 'order-1', supervisorUserId: 'x'.repeat(129), supervisorAccessToken: 'invalid-token' }),
    });
    assert.equal(oversized.status, 400);
    assert.equal(databaseReached, false);
  } finally { await server.close(); }
});

test('supervisor authorization route commits failed-attempt and audit RPC calls when credentials are invalid', async () => {
  const secretHash = await hashPassword('correct horse battery staple');
  let committed = false;
  const executedSql: string[] = [];
  const db: TransactionalSqlExecutor = {
    query: async () => {
      throw new Error('direct db.query must not be used');
    },
    transaction: async (work) => {
      const result = await work({
        query: async <T extends Record<string, unknown>>(sql: string) => {
          executedSql.push(sql);
          if (sql.includes('prodx_supervisor_find_credential')) {
            return { rows: [{ userId: 'supervisor-1', status: 'active', secretHash, failedAttempts: 0, lockedUntil: null }] as unknown as T[] };
          }
          if (sql.includes('prodx_supervisor_record_failed_attempt')) return { rows: [] as T[] };
          if (sql.includes('prodx_record_supervisor_authorization_event') || sql.includes('prodx_record_security_audit_event')) return { rows: [] as T[] };
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      });
      committed = true;
      return result;
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
      body: JSON.stringify({ action: 'refund', orderId: 'order-1', supervisorUsername: 'supervisor', supervisorSecret: 'wrong-secret' }),
    });
    assert.equal(response.status, 401);
    assert.equal(committed, true, 'transaction must commit so failed_attempts and security audit event are persisted');
    assert.ok(executedSql.some((sql) => sql.includes('prodx_supervisor_record_failed_attempt')));
    assert.ok(executedSql.some((sql) => sql.includes('prodx_record_supervisor_authorization_event') || sql.includes('prodx_record_security_audit_event')));
  } finally { await server.close(); }
});

test('discount supervisor route binds approval to server policy, checkout fingerprint, and requester session', async () => {
  const secretHash = await hashPassword('manager-pin-1234');
  const inserted: { sql: string; parameters: readonly unknown[] }[] = [];
  const checkout = {
    idempotencyKey: 'discount-checkout-1', storeId: principal.storeId, registerId: 'register-1', cashierId: principal.userId,
    items: [{ lineId: 'line-1', product: { id: 'product-1' }, quantity: 1, discountBps: 1600,
      unitPrice: { amountInCents: 1000, currency: 'THB' }, lineSubtotal: { amountInCents: 840, currency: 'THB' },
      lineTax: { amountInCents: 0, currency: 'THB' }, lineTotal: { amountInCents: 840, currency: 'THB' } }],
    totals: { grossSubtotal: { amountInCents: 1000, currency: 'THB' }, itemDiscounts: { amountInCents: 160, currency: 'THB' },
      orderDiscount: { amountInCents: 0, currency: 'THB' }, netSubtotal: { amountInCents: 840, currency: 'THB' },
      totalTax: { amountInCents: 0, currency: 'THB' }, grandTotal: { amountInCents: 840, currency: 'THB' }, totalItemsCount: 1 },
    payments: [{ id: 'payment-1', method: 'cash', amount: { amountInCents: 840, currency: 'THB' },
      tenderedCash: { amountInCents: 840, currency: 'THB' }, changeGiven: { amountInCents: 0, currency: 'THB' }, timestamp: '2026-11-01T00:00:00.000Z' }],
  };
  const db: TransactionalSqlExecutor = {
    query: async () => { throw new Error('direct query must not be used'); },
    transaction: async (work) => work({
      query: async <T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) => {
        inserted.push({ sql, parameters });
        if (sql.includes('FROM prodx_discount_policies')) return { rows: [{ require_supervisor_approval: true, max_discount_without_approval_bps: 1500 }] as unknown as T[] };
        if (sql.includes('FROM prodx_products')) return { rows: [{ id: 'product-1', price_amount: '10.00', currency: 'THB' }] as unknown as T[] };
        if (sql.includes('prodx_supervisor_find_credential') || sql.includes('prodx_auth_find_supervisor_credential')) return { rows: [{ userId: 'manager-1', organizationId: principal.organizationId, status: 'active', secretHash, failedAttempts: 0, lockedUntil: null }] as unknown as T[] };
        if (sql.includes('SELECT m.user_id AS "userId"')) return { rows: [{ userId: 'manager-1' }] as unknown as T[] };
        return { rows: [] as T[] };
      },
    }),
  };
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: (_context, permission) => permission === 'pos.discount',
    configureRoutes: (configuredApp) => registerSupervisorAuthorizationRoute(configuredApp, db),
  });
  const server = await start(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/authorizations/supervisor`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'discount', checkout, supervisorUsername: 'manager', supervisorSecret: 'manager-pin-1234' }),
    });
    assert.equal(response.status, 201);
    const body = await response.json() as { authorizationToken: string; supervisorUserId: string };
    assert.ok(body.authorizationToken.length >= 40);
    assert.equal(body.supervisorUserId, 'manager-1');
    const insert = inserted.find(({ sql }) => sql.includes('INSERT INTO prodx_supervisor_authorizations'));
    assert.ok(insert);
    assert.equal(insert.parameters[6], 'discount');
    assert.equal(insert.parameters[7], null, 'discount grant must not be bound to a client order id');
    assert.equal(insert.parameters[8], checkout.idempotencyKey);
    assert.match(String(insert.parameters[9]), /^[0-9a-f]{64}$/);
    assert.equal(insert.parameters[10], 1500);
    assert.equal(insert.parameters[11], true);
    assert.ok(inserted.some(({ sql }) => sql.includes('SUPERVISOR_AUTHORIZATION_REQUESTED')));
  } finally { await server.close(); }
});

test('discount supervisor route ignores tampered client checkout.totals and enforces server catalog BigInt discount threshold', async () => {
  const secretHash = await hashPassword('manager-pin-1234');
  let issuedCount = 0;
  const db: TransactionalSqlExecutor = {
    query: async () => { throw new Error('direct query must not be used'); },
    transaction: async (work) => work({
      query: async <T extends Record<string, unknown>>(sql: string) => {
        if (sql.includes('FROM prodx_discount_policies')) return { rows: [{ require_supervisor_approval: true, max_discount_without_approval_bps: 1500 }] as unknown as T[] };
        if (sql.includes('FROM prodx_products')) return { rows: [{ id: 'product-1', price_amount: '10.00', currency: 'THB' }] as unknown as T[] };
        if (sql.includes('prodx_supervisor_find_credential') || sql.includes('prodx_auth_find_supervisor_credential')) return { rows: [{ userId: 'manager-1', organizationId: principal.organizationId, status: 'active', secretHash, failedAttempts: 0, lockedUntil: null }] as unknown as T[] };
        if (sql.includes('SELECT m.user_id AS "userId"')) return { rows: [{ userId: 'manager-1' }] as unknown as T[] };
        if (sql.includes('INSERT INTO prodx_supervisor_authorizations')) { issuedCount += 1; return { rows: [] as T[] }; }
        return { rows: [] as T[] };
      },
    }),
  };
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: (_context, permission) => permission === 'pos.discount',
    configureRoutes: (configuredApp) => registerSupervisorAuthorizationRoute(configuredApp, db),
  });
  const server = await start(app);
  try {
    // Case 1: Actual server-catalog discount is 5% (<= 15% policy threshold),
    // but client tampers totals to falsely claim a 50% discount. Must be rejected (403).
    const inflatedClientTotals = {
      idempotencyKey: 'discount-tampered-inflated', storeId: principal.storeId, registerId: 'register-1', cashierId: principal.userId,
      items: [{ lineId: 'line-1', product: { id: 'product-1' }, quantity: 1, discountBps: 500,
        unitPrice: { amountInCents: 1000, currency: 'THB' }, lineSubtotal: { amountInCents: 500, currency: 'THB' },
        lineTax: { amountInCents: 0, currency: 'THB' }, lineTotal: { amountInCents: 500, currency: 'THB' } }],
      totals: { grossSubtotal: { amountInCents: 1000, currency: 'THB' }, itemDiscounts: { amountInCents: 500, currency: 'THB' },
        orderDiscount: { amountInCents: 0, currency: 'THB' }, netSubtotal: { amountInCents: 500, currency: 'THB' },
        totalTax: { amountInCents: 0, currency: 'THB' }, grandTotal: { amountInCents: 500, currency: 'THB' }, totalItemsCount: 1 },
      payments: [{ id: 'payment-tamper-1', method: 'cash', amount: { amountInCents: 500, currency: 'THB' },
        tenderedCash: { amountInCents: 500, currency: 'THB' }, changeGiven: { amountInCents: 0, currency: 'THB' }, timestamp: '2026-11-01T00:00:00.000Z' }],
    };
    const rejected = await fetch(`${server.baseUrl}/api/v1/authorizations/supervisor`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'discount', checkout: inflatedClientTotals, supervisorUsername: 'manager', supervisorSecret: 'manager-pin-1234' }),
    });
    assert.equal(rejected.status, 403, 'tampered client totals claiming 50% discount must not override authoritative 5% catalog calculation');
    assert.equal(issuedCount, 0);

    // Case 2: Combined 10% item + 10% order discount = 19% effective (> 15% threshold),
    // even when client tampers checkout.totals to claim only 1% discount. Must succeed (201).
    const understatedClientTotals = {
      idempotencyKey: 'discount-tampered-understated', storeId: principal.storeId, registerId: 'register-1', cashierId: principal.userId,
      orderDiscountBps: 1000,
      items: [{ lineId: 'line-1', product: { id: 'product-1' }, quantity: 1, discountBps: 1000,
        unitPrice: { amountInCents: 1000, currency: 'THB' }, lineSubtotal: { amountInCents: 990, currency: 'THB' },
        lineTax: { amountInCents: 0, currency: 'THB' }, lineTotal: { amountInCents: 990, currency: 'THB' } }],
      totals: { grossSubtotal: { amountInCents: 10000, currency: 'THB' }, itemDiscounts: { amountInCents: 100, currency: 'THB' },
        orderDiscount: { amountInCents: 0, currency: 'THB' }, netSubtotal: { amountInCents: 9900, currency: 'THB' },
        totalTax: { amountInCents: 0, currency: 'THB' }, grandTotal: { amountInCents: 9900, currency: 'THB' }, totalItemsCount: 1 },
      payments: [{ id: 'payment-tamper-2', method: 'cash', amount: { amountInCents: 9900, currency: 'THB' },
        tenderedCash: { amountInCents: 9900, currency: 'THB' }, changeGiven: { amountInCents: 0, currency: 'THB' }, timestamp: '2026-11-01T00:00:00.000Z' }],
    };
    const granted = await fetch(`${server.baseUrl}/api/v1/authorizations/supervisor`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'discount', checkout: understatedClientTotals, supervisorUsername: 'manager', supervisorSecret: 'manager-pin-1234' }),
    });
    assert.equal(granted.status, 201, 'authoritative 1900 bps combined discount must trigger approval even when client totals claim 1%');
    assert.equal(issuedCount, 1);
  } finally { await server.close(); }
});

test('discount supervisor route accepts a verified Supabase subject without requiring a local password credential', async () => {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const db: TransactionalSqlExecutor = {
    query: async () => { throw new Error('direct query must not be used'); },
    transaction: async (work) => work({
      query: async <T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) => {
        calls.push({ sql, parameters });
        if (sql.includes('FROM prodx_discount_policies')) return { rows: [{ require_supervisor_approval: true, max_discount_without_approval_bps: 1500 }] as unknown as T[] };
        if (sql.includes('FROM prodx_products')) return { rows: [{ id: 'product-1', price_amount: '10.00', currency: 'THB' }] as unknown as T[] };
        if (sql.includes('prodx_auth_find_supervisor_by_supabase_subject')) return { rows: [{ userId: 'manager-1', status: 'active' }] as unknown as T[] };
        if (sql.includes('SELECT m.user_id AS "userId"')) return { rows: [{ userId: 'manager-1' }] as unknown as T[] };
        if (sql.includes('prodx_auth_find_supervisor_credential') || sql.includes('prodx_supervisor_find_credential')) throw new Error('Supabase identity must not require a local password credential');
        return { rows: [] as T[] };
      },
    }),
  };
  const app = createApp({ authenticateRequest: () => principal, authorizeRequest: (_context, permission) => permission === 'pos.discount', configureRoutes: (configuredApp) => registerSupervisorAuthorizationRoute(configuredApp, db, async (token) => token === 'verified-supabase-token' ? { userId: '00000000-0000-4000-8000-000000001015', expiresAt: new Date(Date.now() + 60_000) } : null) });
  const server = await start(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/authorizations/supervisor`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'discount', checkout: {
        idempotencyKey: 'discount-checkout-supabase', storeId: principal.storeId, registerId: 'register-1', cashierId: principal.userId,
        items: [{ lineId: 'line-1', product: { id: 'product-1' }, quantity: 1, discountBps: 1600, unitPrice: { amountInCents: 1000, currency: 'THB' }, lineSubtotal: { amountInCents: 840, currency: 'THB' }, lineTax: { amountInCents: 0, currency: 'THB' }, lineTotal: { amountInCents: 840, currency: 'THB' } }],
        totals: { grossSubtotal: { amountInCents: 1000, currency: 'THB' }, itemDiscounts: { amountInCents: 160, currency: 'THB' }, orderDiscount: { amountInCents: 0, currency: 'THB' }, netSubtotal: { amountInCents: 840, currency: 'THB' }, totalTax: { amountInCents: 0, currency: 'THB' }, grandTotal: { amountInCents: 840, currency: 'THB' }, totalItemsCount: 1 },
        payments: [{ id: 'payment-supabase', method: 'cash', amount: { amountInCents: 840, currency: 'THB' }, tenderedCash: { amountInCents: 840, currency: 'THB' }, changeGiven: { amountInCents: 0, currency: 'THB' }, timestamp: '2026-11-01T00:00:00.000Z' }],
      }, supervisorUserId: 'manager-1', supervisorAccessToken: 'verified-supabase-token' }),
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json() as { supervisorUserId: string }).supervisorUserId, 'manager-1');
    const mapping = calls.find(({ sql }) => sql.includes('prodx_auth_find_supervisor_by_supabase_subject'));
    assert.ok(mapping);
    assert.deepEqual(mapping.parameters, [principal.organizationId, principal.storeId, '00000000-0000-4000-8000-000000001015']);
    assert.equal(calls.some(({ sql }) => sql.includes('prodx_auth_find_supervisor_credential') || sql.includes('prodx_supervisor_find_credential')), false);
    assert.ok(calls.some(({ sql }) => sql.includes('pos.discount.approve')));
    assert.ok(calls.some(({ sql, parameters }) => (sql.includes('prodx_record_security_audit_event') || sql.includes('prodx_record_supervisor_authorization_event')) && (parameters[3] === 'SUPERVISOR_AUTHORIZATION_GRANTED' || parameters[4] === 'SUPERVISOR_AUTHORIZATION_GRANTED')));
  } finally { await server.close(); }
});

test('invalid Supabase supervisor reauthentication is audited and fails closed', async () => {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const db: TransactionalSqlExecutor = {
    query: async () => { throw new Error('direct query must not be used'); },
    transaction: async (work) => work({ query: async <T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) => { calls.push({ sql, parameters }); return { rows: [] as T[] }; } }),
  };
  const app = createApp({ authenticateRequest: () => principal, authorizeRequest: (_context, permission) => permission === 'pos.refund', configureRoutes: (configuredApp) => registerSupervisorAuthorizationRoute(configuredApp, db, async () => null) });
  const server = await start(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/authorizations/supervisor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'refund', orderId: 'order-1', supervisorUserId: 'manager-1', supervisorAccessToken: 'invalid-token' }) });
    assert.equal(response.status, 401);
    assert.ok(calls.some(({ sql }) => (sql.includes('prodx_record_security_audit_event') || sql.includes('prodx_record_supervisor_authorization_event')) && sql.includes('SUPERVISOR_AUTH_FAILED')));
    assert.equal(calls.some(({ sql }) => sql.includes('prodx_auth_find_supervisor_credential') || sql.includes('prodx_supervisor_find_credential')), false);
  } finally { await server.close(); }
});

test('Supabase identity provider outage returns 503 before opening an authorization transaction', async () => {
  let databaseReached = false;
  const db: TransactionalSqlExecutor = {
    query: async () => { databaseReached = true; return { rows: [] }; },
    transaction: async () => { databaseReached = true; throw new Error('database must not be reached'); },
  };
  const app = createApp({ authenticateRequest: () => principal, authorizeRequest: (_context, permission) => permission === 'pos.refund', configureRoutes: (configuredApp) => registerSupervisorAuthorizationRoute(configuredApp, db, async () => { throw new Error('JWKS unavailable'); }) });
  const server = await start(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/authorizations/supervisor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'refund', orderId: 'order-1', supervisorUserId: 'manager-1', supervisorAccessToken: 'valid-looking-token' }) });
    assert.equal(response.status, 503);
    assert.equal(databaseReached, false);
  } finally { await server.close(); }
});

test('supervisor directory returns only active, Supabase-mapped supervisors for the current store', async () => {
  let queryText = '';
  let queryParameters: readonly unknown[] = [];
  const db: TransactionalSqlExecutor = {
    query: async <T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) => {
      queryText = sql;
      queryParameters = parameters;
      return { rows: [{ id: 'manager-1', username: 'manager-login', name: 'Store Manager', role: 'manager' }] as unknown as T[] };
    },
    transaction: async () => { throw new Error('directory read must not open an explicit transaction'); },
  };
  const app = createApp({ authenticateRequest: () => principal, authorizeRequest: (_context, permission) => permission === 'pos.sell', configureRoutes: (configuredApp) => registerSupervisorAuthorizationRoute(configuredApp, db, async () => null) });
  const server = await start(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/authorizations/supervisors`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json() as { supervisors: unknown[] }).supervisors, [{ id: 'manager-1', username: 'manager-login', name: 'Store Manager', role: 'manager' }]);
    assert.deepEqual(queryParameters, [principal.organizationId, principal.storeId]);
    assert.match(queryText, /u\.supabase_auth_user_id IS NOT NULL/i);
    assert.match(queryText, /m\.active = TRUE/i);
    assert.match(queryText, /p\.permission_key IN \('pos\.discount\.approve', 'pos\.refund', 'pos\.void'\)/i);
  } finally { await server.close(); }
});

