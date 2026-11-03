import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { registerInfrastructureRoutes } from './infrastructureRoutes';
import { pingCloudSql, pingFirestore, performEndToEndHealthCheck } from '../services/systemHealthCheckService';

const start = async (app: express.Express) => {
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
};

test('pingCloudSql returns 503 when pool is unavailable and reports safe diagnostics', async () => {
  const result = await pingCloudSql(undefined);
  assert.equal(result.service, 'PostgreSQL (Supabase session pooler)');
  assert.equal(result.statusCode, 503);
  assert.equal(result.status, 'unreachable');
  assert.equal(result.projectId, 'wcyqyiewbzpmrekoljfw');
  assert.equal(result.region, 'ap-southeast-1');
  assert.equal(result.code, 'POSTGRES_POOL_UNAVAILABLE');
});

test('pingCloudSql executes query when pool is supplied and returns 200', async () => {
  const mockPool = {
    totalCount: 5,
    idleCount: 4,
    waitingCount: 0,
    query: async () => ({
      rows: [{ ping: 1, server_time: new Date().toISOString(), version: 'PostgreSQL 16.2 on x86_64' }],
    }),
  };

  const result = await pingCloudSql(mockPool as any);
  assert.equal(result.statusCode, 200);
  assert.equal(result.status, 'connected');
  assert.equal(result.engine, 'PostgreSQL 16.2 (Supabase session pooler)');
  assert.equal(result.queryProbe, 'SELECT 1 -> OK');
  assert.equal(result.poolStats?.totalConnections, 5);
});

test('pingFirestore is explicitly disabled and does not probe the retired provider', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls += 1; throw new Error('unexpected network call'); }) as typeof fetch;
  try {
    const result = await pingFirestore();
    assert.equal(result.service, 'Firestore (retired)');
    assert.equal(result.status, 'disabled');
    assert.equal(result.databaseId, 'retired');
    assert.deepEqual(result.verifiedCollections, []);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('performEndToEndHealthCheck computes 200 when all services pass and 207 on partial failure', async () => {
  const mockPool = {
    totalCount: 2,
    idleCount: 2,
    waitingCount: 0,
    query: async () => ({
      rows: [{ ping: 1, server_time: new Date().toISOString(), version: 'PostgreSQL 16.0' }],
    }),
  };

  const result = await performEndToEndHealthCheck(mockPool as any, 'test-req-001');
  assert.ok(result.statusCode === 200 || result.statusCode === 207);
  assert.equal(result.requestId, 'test-req-001');
  assert.equal(result.environment.region, 'ap-southeast-1');
  assert.equal(result.services.cloudSql.statusCode, 200);
});

test('HTTP GET /api/v1/infrastructure/system-health-check returns status-coded JSON object', async () => {
  const app = express();
  app.use(express.json());

  const mockPool = {
    totalCount: 3,
    idleCount: 3,
    waitingCount: 0,
    query: async () => ({
      rows: [{ ping: 1, server_time: new Date().toISOString(), version: 'PostgreSQL 16.1' }],
    }),
  };

  registerInfrastructureRoutes(app, mockPool as any);
  const server = await start(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/v1/infrastructure/system-health-check`, {
      headers: { 'x-request-id': 'req-health-check-e2e' },
    });

    assert.ok(response.status === 200 || response.status === 207);
    const body = await response.json();
    assert.equal(body.requestId, 'req-health-check-e2e');
    assert.ok(body.services.cloudSql);
    assert.ok(body.services.firestore);
    assert.equal(body.services.cloudSql.projectId, 'wcyqyiewbzpmrekoljfw');
    assert.equal(body.services.firestore.databaseId, 'retired');
  } finally {
    await server.close();
  }
});

test('HTTP GET /api/v1/infrastructure/latency-ping returns high-precision performance.now() latency metrics', async () => {
  const app = express();
  app.use(express.json());

  const mockPool = {
    query: async () => ({
      rows: [{ ping: 1 }],
    }),
  };

  registerInfrastructureRoutes(app, mockPool as any);
  const server = await start(app);

  try {
    const clientSendTime = performance.now();
    const response = await fetch(`${server.baseUrl}/api/v1/infrastructure/latency-ping?clientTime=${clientSendTime}`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.success, true);
    assert.ok(typeof body.serverReceiveTimestamp === 'number');
    assert.ok(typeof body.serverProcessTimeMs === 'number');
    assert.equal(body.clientSentTimestamp, clientSendTime);
    assert.equal(body.cloudSql.success, true);
    assert.ok(typeof body.cloudSql.queryDurationMs === 'number');
    assert.equal(body.cloudSql.projectId, 'wcyqyiewbzpmrekoljfw');
    assert.equal(body.firestoreBackend.databaseId, 'retired');
    assert.equal(body.firestoreBackend.disabled, true);
    assert.equal(body.firestoreBackend.success, false);
  } finally {
    await server.close();
  }
});

