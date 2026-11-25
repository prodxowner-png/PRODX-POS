import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from './createApp.ts';
import { createLogger } from '../observability/logger.ts';

const principal = {
  userId: 'user-obs-1',
  organizationId: 'org-obs-1',
  storeId: 'store-obs-1',
};

const start = async (app: ReturnType<typeof createApp>) => {
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

test('createApp propagates incoming W3C traceparent and emits structured HTTP access logs with tenant context', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = createLogger({
    writeStdout: (line) => stdout.push(line),
    writeStderr: (line) => stderr.push(line),
  });

  const app = createApp({
    logger: log,
    authenticateRequest: () => principal,
    configureRoutes: (configuredApp) => {
      configuredApp.get('/api/v1/obs-ping', (_req, res) => {
        res.json({ ok: true });
      });
    },
  });
  const server = await start(app);

  try {
    const incomingTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const response = await fetch(`${server.baseUrl}/api/v1/obs-ping`, {
      headers: {
        'x-request-id': 'req-obs-001',
        traceparent: `00-${incomingTraceId}-00f067aa0ba902b7-01`,
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), 'req-obs-001');
    const echoedTraceparent = response.headers.get('traceparent');
    assert.ok(echoedTraceparent);
    assert.match(echoedTraceparent, new RegExp(`^00-${incomingTraceId}-[0-9a-f]{16}-01$`));

    assert.equal(stdout.length, 1);
    assert.equal(stderr.length, 0);
    const entry = JSON.parse(stdout[0]);
    assert.equal(entry.level, 'info');
    assert.equal(entry.event, 'http.request');
    assert.equal(entry.requestId, 'req-obs-001');
    assert.equal(entry.traceId, incomingTraceId);
    assert.equal(entry.method, 'GET');
    assert.equal(entry.path, '/api/v1/obs-ping');
    assert.equal(entry.status, 200);
    assert.equal(typeof entry.durationMs, 'number');
    assert.equal(entry.organizationId, 'org-obs-1');
    assert.equal(entry.storeId, 'store-obs-1');
  } finally {
    await server.close();
  }
});

test('createApp generates a W3C traceparent when absent and logs 4xx as warn', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = createLogger({
    writeStdout: (line) => stdout.push(line),
    writeStderr: (line) => stderr.push(line),
  });

  const app = createApp({
    logger: log,
    authenticateRequest: () => null,
  });
  const server = await start(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/v1/health`);
    assert.equal(response.status, 401);
    const traceparent = response.headers.get('traceparent');
    assert.ok(traceparent);
    assert.match(traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);

    assert.equal(stdout.length, 0);
    assert.equal(stderr.length, 1);
    const entry = JSON.parse(stderr[0]);
    assert.equal(entry.level, 'warn');
    assert.equal(entry.event, 'http.request');
    assert.equal(entry.status, 401);
    assert.equal(entry.traceId, traceparent.split('-')[1]);
  } finally {
    await server.close();
  }
});
