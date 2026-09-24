import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from './createApp';
import { registerCatalogRoute } from './catalog-route';

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

test('catalog production route is authenticated, authorized, and store scoped', async () => {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const db = {
    query: async <T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) => {
      calls.push({ sql, parameters });
      if (sql.includes('FROM prodx_categories')) {
        return { rows: [{ id: 'cat-1', name: 'Coffee', slug: 'coffee' }] as T[] };
      }
      return { rows: [] as T[] };
    },
  };

  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: (_context, permission) => permission === 'catalog:read',
    configureRoutes: (configuredApp) => registerCatalogRoute(configuredApp, db),
  });
  const server = await start(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/v1/catalog/categories`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{ id: 'cat-1', name: 'Coffee', slug: 'coffee' }]);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].parameters, ['store-1']);
  } finally {
    await server.close();
  }
});

test('catalog production route denies unauthorized access before database query', async () => {
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
    configureRoutes: (configuredApp) => registerCatalogRoute(configuredApp, db),
  });
  const server = await start(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/v1/catalog/categories`);
    assert.equal(response.status, 403);
    assert.equal(queried, false);
  } finally {
    await server.close();
  }
});
