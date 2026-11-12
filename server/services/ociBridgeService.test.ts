import test from 'node:test';
import assert from 'node:assert/strict';
import { getOciTenancyStatus, type OciBridgeEnv } from './ociBridgeService.ts';

const env: OciBridgeEnv = {
  OCI_BRIDGE_PREVIEW_URL: 'https://61cdcc39-prodx-oci-bridge-staging.prodx-pos.workers.dev',
  OCI_BRIDGE_ACCESS_CLIENT_ID: 'test-client-id',
  OCI_BRIDGE_ACCESS_CLIENT_SECRET: 'test-client-secret',
  OCI_BRIDGE_BEARER_TOKEN: 'test-bridge-token',
};

test('OCI bridge reports only allowlisted tenancy metadata and sends both authentication layers', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const result = await getOciTenancyStatus(env, (async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({ tenancy: {
      id: 'must-not-be-returned', name: 'posproductionapp', home_region_key: 'SIN',
      lifecycle_state: 'ACTIVE', time_created: '2026-08-30T00:19:21.209Z',
    } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status.name, 'posproductionapp');
  assert.equal(result.status.homeRegionKey, 'SIN');
  assert.equal(result.status.lifecycleState, 'ACTIVE');
  assert.equal(result.status.integration, 'read-only');
  assert.equal('id' in result.status, false);
  assert.equal(requestUrl, 'https://61cdcc39-prodx-oci-bridge-staging.prodx-pos.workers.dev/v1/oci/tenancy');
  assert.equal(requestInit?.method, 'GET');
  assert.equal(requestInit?.redirect, 'manual');
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get('authorization'), 'Bearer test-bridge-token');
  assert.equal(headers.get('cf-access-client-id'), 'test-client-id');
  assert.equal(headers.get('cf-access-client-secret'), 'test-client-secret');
});

test('OCI bridge fails closed when configuration is incomplete', async () => {
  const result = await getOciTenancyStatus({ ...env, OCI_BRIDGE_BEARER_TOKEN: '' }, (async () => {
    throw new Error('fetch must not be called');
  }) as typeof fetch);
  assert.deepEqual(result, { ok: false, statusCode: 503, code: 'OCI_BRIDGE_NOT_CONFIGURED' });
});

test('OCI bridge rejects non-Staging and malformed upstream URLs before network access', async () => {
  for (const url of [
    'https://example.com',
    'https://61cdcc39-prodx-oci-bridge.workers.dev',
    'http://61cdcc39-prodx-oci-bridge-staging.prodx-pos.workers.dev',
    'https://user:pass@61cdcc39-prodx-oci-bridge-staging.prodx-pos.workers.dev',
  ]) {
    const result = await getOciTenancyStatus({ ...env, OCI_BRIDGE_PREVIEW_URL: url }, (async () => {
      throw new Error('fetch must not be called');
    }) as typeof fetch);
    assert.deepEqual(result, { ok: false, statusCode: 503, code: 'OCI_BRIDGE_NOT_CONFIGURED' });
  }
});

test('OCI bridge never follows Access redirects', async () => {
  let redirect: RequestRedirect | undefined;
  const result = await getOciTenancyStatus(env, (async (_input, init) => {
    redirect = init?.redirect;
    return new Response(null, { status: 302, headers: { location: 'https://login.example.test' } });
  }) as typeof fetch);
  assert.equal(redirect, 'manual');
  assert.deepEqual(result, { ok: false, statusCode: 502, code: 'OCI_BRIDGE_UPSTREAM_REJECTED' });
});

test('OCI bridge rejects malformed or incomplete upstream tenancy payloads', async () => {
  const result = await getOciTenancyStatus(env, (async () => new Response(
    JSON.stringify({ tenancy: { name: 'posproductionapp', home_region_key: 'SIN' } }), { status: 200 },
  )) as typeof fetch);
  assert.deepEqual(result, { ok: false, statusCode: 502, code: 'OCI_BRIDGE_INVALID_RESPONSE' });
});

test('OCI bridge reports a timeout when the upstream response body read is aborted', async () => {
  const response = new Response(null, { status: 200 });
  response.json = async () => {
    throw new DOMException('The operation timed out', 'TimeoutError');
  };

  const result = await getOciTenancyStatus(env, (async () => response) as typeof fetch);
  assert.deepEqual(result, { ok: false, statusCode: 504, code: 'OCI_BRIDGE_TIMEOUT' });
});
