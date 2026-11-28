import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionSyncApi } from './productionSyncApi';

test('production sync ping uses the server healthz endpoint and bearer auth', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedAuthorization = '';

  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedAuthorization = String(new Headers(init?.headers).get('Authorization') ?? '');
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const api = createProductionSyncApi('token-123', 'https://api.example.test');
    const result = await api.ping(123);

    assert.equal(requestedUrl, 'https://api.example.test/api/v1/healthz');
    assert.equal(requestedAuthorization, 'Bearer token-123');
    assert.equal(result.status, 'ok');
    assert.match(result.serverTimestamp, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('production sync ping uses same-origin API routing when no API origin is configured', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const api = createProductionSyncApi('token-123');
    await api.ping(456);
    assert.equal(requestedUrl, '/api/v1/healthz');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
