import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from './createApp';
import { registerAuditRoute } from './audit-route';

const principal = { userId: 'user-1', organizationId: 'org-1', storeId: 'store-1' };

const start = async (app: ReturnType<typeof createApp>) => {
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { baseUrl: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
};

test('audit production route is authenticated, authorized, and store scoped', async () => {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const db = { query: async <T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) => {
    calls.push({ sql, parameters });
    return { rows: [{ id:'audit-1',store_id:'store-1',register_id:'REG-01',user_id:'user-1',user_name:'Cashier One',action:'stock_adjusted',severity:'warn',details:{reason:'damaged_write_off'},created_at:'2026-09-24T00:00:00.000Z' }] as unknown as T[] };
  }};
  const app = createApp({ authenticateRequest: () => principal, authorizeRequest: (_context, permission) => permission === 'audit.read', configureRoutes: (configuredApp) => registerAuditRoute(configuredApp, db) });
  const server = await start(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/audit/logs?limit=10`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{id:'audit-1',storeId:'store-1',registerId:'REG-01',userId:'user-1',userName:'Cashier One',action:'stock_adjusted',severity:'warn',details:{reason:'damaged_write_off'},timestamp:'2026-09-24T00:00:00.000Z'}]);
    assert.deepEqual(calls[0].parameters, ['store-1',10]);
  } finally { await server.close(); }
});

test('audit production route denies unauthorized access before database query', async () => {
  let queried = false;
  const db = { query: async <T extends Record<string, unknown>>(_sql: string, _parameters: readonly unknown[] = []) => { queried = true; return { rows: [] as unknown as T[] }; } };
  const app = createApp({ authenticateRequest: () => principal, authorizeRequest: () => false, configureRoutes: (configuredApp) => registerAuditRoute(configuredApp, db) });
  const server = await start(app);
  try { const response = await fetch(`${server.baseUrl}/api/v1/audit/logs`); assert.equal(response.status,403); assert.equal(queried,false); }
  finally { await server.close(); }
});

test('POST /api/v1/audit/logs appends an authenticated store-scoped audit event and rejects cross-store writes', async () => {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const db = {
    query: async <T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) => {
      calls.push({ sql, parameters });
      return {
        rows: sql.startsWith('INSERT INTO prodx_audit_log')
          ? [{ id: 'audit-created', created_at: '2026-10-28T08:00:00.000Z' }] as unknown as T[]
          : [] as unknown as T[],
      };
    },
  };
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: () => true,
    configureRoutes: (configuredApp) => registerAuditRoute(configuredApp, db),
  });
  const server = await start(app);
  try {
    const okRes = await fetch(`${server.baseUrl}/api/v1/audit/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: 'store-1',
        action: 'order_completed',
        severity: 'info',
        details: 'Order ORD-101 completed',
      }),
    });
    assert.equal(okRes.status, 201);
    const body = await okRes.json();
    assert.equal(body.action, 'order_completed');
    assert.equal(body.storeId, 'store-1');
    assert.equal(calls.length, 1);

    const crossStoreRes = await fetch(`${server.baseUrl}/api/v1/audit/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: 'store-other',
        action: 'order_completed',
        severity: 'info',
        details: 'Cross-store attempt',
      }),
    });
    assert.equal(crossStoreRes.status, 403);
  } finally {
    await server.close();
  }
});

test('diagnostic batch API validates events and writes stable per-user idempotency keys', async () => {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  let persistedEvent: { id: string; created_at: string } | null = null;
  const db = {
    query: async <T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) => {
      calls.push({ sql, parameters });
      if (sql.startsWith('INSERT INTO prodx_audit_log')) {
        if (persistedEvent) return { rows: [] as unknown as T[] };
        persistedEvent = { id: 'audit-diagnostic-1', created_at: '2026-10-28T08:00:00.000Z' };
        return { rows: [persistedEvent] as unknown as T[] };
      }
      if (sql.includes('source_event_key = $3')) {
        return { rows: persistedEvent ? [persistedEvent] as unknown as T[] : [] as unknown as T[] };
      }
      return { rows: [] as unknown as T[] };
    },
  };
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: () => true,
    configureRoutes: (configuredApp) => registerAuditRoute(configuredApp, db),
  });
  const server = await start(app);
  try {
    const invalid = await fetch(`${server.baseUrl}/api/v1/audit/diagnostics`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [{ id: '', category: 'system', level: 'ERROR', event: 'crash', message: 'failed' }] }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(calls.length, 0);

    const body = {
      batchId: 'batch-001',
      events: [{ id: 'diag-123', category: 'system', level: 'ERROR', event: 'runtime_crash', message: 'runtime crashed', timestamp: 1793174400000 }],
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${server.baseUrl}/api/v1/audit/diagnostics`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      assert.equal(response.status, 202);
      assert.equal((await response.json()).accepted, 1);
    }
    assert.equal(calls.length, 3);
    assert.match(calls[0].sql, /source_event_key/);
    assert.match(calls[0].sql, /ON CONFLICT DO NOTHING/);
    assert.match(calls[0].sql, /RETURNING id, created_at/);
    assert.equal(calls[0].parameters[8], `${principal.userId}:diag-123`);
    assert.equal(calls[1].parameters[8], calls[0].parameters[8]);
    assert.match(calls[2].sql, /SELECT id, created_at[\s\S]*source_event_key = \$3/);
    assert.deepEqual(calls[2].parameters, [principal.organizationId, principal.storeId, `${principal.userId}:diag-123`]);
  } finally { await server.close(); }
});
