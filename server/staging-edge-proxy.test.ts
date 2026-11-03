import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createStagingEdgeProxy, type StagingEdgeProxyEnv } from './staging-edge-proxy.js';

function mockRequest(url: string, method = 'POST', authorization?: string) {
  const request = Readable.from([]) as Readable & {
    url: string; method: string; headers: Record<string, string>;
  };
  request.url = url;
  request.method = method;
  request.headers = authorization ? { authorization } : {};
  return request;
}

function mockResponse() {
  const headers = new Map<string, string>();
  return {
    statusCode: 200,
    headers,
    body: '',
    headersSent: false,
    destroyed: false,
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); return this; },
    end(value = '') { this.body = value; this.headersSent = true; return this; },
    destroy() { this.destroyed = true; return this; },
  };
}

const completeEnv: StagingEdgeProxyEnv = {
  VERCEL_ENV: 'preview',
  POS_STAGING_PROXY_TOKEN: 'test-proxy-token',
  POS_STAGING_WORKER_ORIGIN: 'https://prodx-pos-edge-sync-staging.example.workers.dev',
  POS_STAGING_ACCESS_TOKEN: 'test-access-token',
  POS_STAGING_OPS_ACCESS_TOKEN: 'test-ops-access-token',
  POS_STAGING_MTLS_CERT_PEM: 'test-cert',
  POS_STAGING_MTLS_KEY_PEM: 'test-key',
};

test('production runtime fails closed without proxying', async () => {
  const response = mockResponse();
  await createStagingEdgeProxy({ ...completeEnv, VERCEL_ENV: 'production' })(
    mockRequest('/api/staging-edge?path=api%2Fv1%2Fpos%2Fsync-batch', 'POST', 'Bearer test-proxy-token') as never,
    response as never,
  );
  assert.equal(response.statusCode, 404);
  assert.match(response.body, /NOT_FOUND/);
});

test('preview requests require the dedicated proxy bearer token', async () => {
  const response = mockResponse();
  await createStagingEdgeProxy(completeEnv)(
    mockRequest('/api/staging-edge?path=api%2Fv1%2Fpos%2Fsync-batch') as never,
    response as never,
  );
  assert.equal(response.statusCode, 401);
  assert.match(response.body, /UNAUTHORIZED/);
});

test('proxy rejects paths outside the two explicit staging endpoints', async () => {
  const response = mockResponse();
  await createStagingEdgeProxy(completeEnv)(
    mockRequest('/api/staging-edge?path=api%2Fv1%2Fadmin%2Fusers', 'POST', 'Bearer test-proxy-token') as never,
    response as never,
  );
  assert.equal(response.statusCode, 404);
  assert.match(response.body, /NOT_FOUND/);
});

test('proxy fails closed when any upstream security credential is missing', async () => {
  const response = mockResponse();
  await createStagingEdgeProxy({ ...completeEnv, POS_STAGING_MTLS_KEY_PEM: '' })(
    mockRequest('/api/staging-edge?path=api%2Fv1%2Fpos%2Fsync-batch', 'POST', 'Bearer test-proxy-token') as never,
    response as never,
  );
  assert.equal(response.statusCode, 503);
  assert.match(response.body, /STAGING_PROXY_NOT_CONFIGURED/);
});

test('receipt status requires a bounded idempotency key and GET only', async () => {
  const response = mockResponse();
  await createStagingEdgeProxy(completeEnv)(
    mockRequest('/api/staging-edge?path=api%2Fv1%2Fpos%2Freceipt-status&idempotency_key=short', 'GET', 'Bearer test-proxy-token') as never,
    response as never,
  );
  assert.equal(response.statusCode, 404);
});


test('proxy rejects non-staging Worker origins instead of becoming an open proxy', async () => {
  const response = mockResponse();
  await createStagingEdgeProxy({ ...completeEnv, POS_STAGING_WORKER_ORIGIN: 'https://attacker.example.com' })(
    mockRequest('/api/staging-edge?path=api%2Fv1%2Fpos%2Fsync-batch', 'POST', 'Bearer test-proxy-token') as never,
    response as never,
  );
  assert.equal(response.statusCode, 503);
  assert.match(response.body, /STAGING_UPSTREAM_NOT_ALLOWED/);
});


test('diagnostics endpoint is restricted to GET with a valid terminal UUID', async () => {
  const response = mockResponse();
  await createStagingEdgeProxy({ ...completeEnv, POS_STAGING_OPS_ACCESS_TOKEN: '' })(
    mockRequest('/api/staging-edge?path=api%2Fv1%2Fops%2Fterminal-sync-diagnostics&terminal_id=123e4567-e89b-42d3-a456-426614174000', 'GET', 'Bearer test-proxy-token') as never,
    response as never,
  );
  assert.equal(response.statusCode, 503);
  assert.match(response.body, /STAGING_PROXY_NOT_CONFIGURED/);
});
