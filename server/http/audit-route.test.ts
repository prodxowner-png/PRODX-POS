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
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
};

test('audit production route is authenticated, authorized, and store scoped', async () => {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const db = {
    query: async <T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) => {
      calls.push({ sql, parameters });
      return {
        rows: [{
          id: 'audit-1',
          store_id: 'store-1',
          register_id: 'REG-01',
          user_id: 'user-1',
          user_name: 'Cashier One',
          action: 'stock_adjusted',
          severity: 'warn',
          details: { reason: 'damaged_write_off' },
          created_at: '2026-09-24T00:00:00.000Z',
        }] as T[],
      };
    },
  };

  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: (_context, permission) => permission === 'audit:read',
    configureRoutes: (configuredApp) => registerAuditRoute(configuredApp, db),
  });
  const server = await start(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/v1/audit/logs?limit=10`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{
      id: 'audit-1',
      storeId: 'store-1',
      registerId: 'REG-01',
      userId: 'user-1',
      userName: 'Cashier One',
      action: 'stock_adjusted',
      severity: 'warn',
      details: { reason: 'damaged_write_off' },
      timestamp: '2026-09-24T00:00:00.000Z',
    }]);
    assert.deepEqual(calls[0].parameters, ['store-1', 10]);
  } finally {
    await server.close();
  }
});

test('audit production route denies unauthorized access before database query', async () => {
  let queried = false;
  const db = {
    query: async <T extends Record<string, unknown>>(_sql: string, _parameters: readonly unknown[] = []) => {
      queried = true;
      return { rows: [] as T[] };
    },
  };

  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: () => false,
    configureRoutes: (configuredApp) => registerAuditRoute(configuredApp, db),
  });
  const server = await start(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/v1/audit/logs`);
    assert.equal(response.status, 403);
    assert.equal(queried, false);
  } finally {
    await server.close();
  }
});
