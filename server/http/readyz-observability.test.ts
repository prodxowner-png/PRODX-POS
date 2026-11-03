import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from './createApp';

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

test('readiness logs only safe dependency diagnostics and the request id', async () => {
  const logs: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };

  const app = createApp({
    authenticateRequest: () => null,
    readinessCheck: async () => {
      const error = new Error('postgres://user:secret@example.invalid/prodx');
      Object.assign(error, { code: 'ECONNREFUSED' });
      throw error;
    },
  });
  const server = await start(app);

  try {
    const response = await fetch(server.baseUrl + '/api/v1/readyz', {
      headers: { 'x-request-id': 'readyz-safe-log-001' },
    });

    assert.equal(response.status, 503);
    assert.deepEqual(logs, [[
      'PRODX readiness check failed',
      {
        requestId: 'readyz-safe-log-001',
        status: 503,
        name: 'Error',
        code: 'ECONNREFUSED',
      },
    ]]);
    assert.equal(JSON.stringify(logs).includes('postgres://user:secret'), false);
  } finally {
    await server.close();
    console.error = originalError;
  }
});

test('unhandled route errors log structured correlation diagnostics without leaking secrets', async () => {
  const logs: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };

  const principal = { userId: 'user-1', organizationId: 'org-1', storeId: 'store-1' };
  const app = createApp({
    authenticateRequest: () => principal,
    configureRoutes: (configuredApp) => {
      configuredApp.get('/api/v1/boom', () => {
        const err = new Error('Bearer secret-jwt-token-do-not-leak');
        Object.assign(err, { code: 'ECONNRESET', stage: 'database_query' });
        throw err;
      });
    },
  });
  const server = await start(app);

  try {
    const response = await fetch(server.baseUrl + '/api/v1/boom', {
      headers: { 'x-request-id': 'corr-err-500' },
    });

    assert.equal(response.status, 500);
    assert.equal(response.headers.get('x-request-id'), 'corr-err-500');
    assert.deepEqual(logs, [[
      'PRODX unhandled request error',
      {
        requestId: 'corr-err-500',
        method: 'GET',
        path: '/api/v1/boom',
        status: 500,
        name: 'Error',
        code: 'ECONNRESET',
        stage: 'database_query',
      },
    ]]);
    assert.equal(JSON.stringify(logs).includes('secret-jwt-token-do-not-leak'), false);
  } finally {
    await server.close();
    console.error = originalError;
  }
});

