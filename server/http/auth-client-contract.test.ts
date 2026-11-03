import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionAuthApi } from '../../src/adapters/authApiClient';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

test('production auth client sends bearer token when logging out and accepts 204', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const api = createProductionAuthApi('https://auth.example.test/', async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(null, { status: 204 });
  });

  await api.logout(' session-token ');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://auth.example.test/auth/logout');
  assert.equal(calls[0].init?.method, 'POST');
  assert.equal(new Headers(calls[0].init?.headers).get('authorization'), 'Bearer session-token');
});

test('production auth client sends bearer token when loading stores', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const api = createProductionAuthApi('https://auth.example.test', async (input, init) => {
    calls.push({ url: String(input), init });
    return jsonResponse([]);
  });

  assert.deepEqual(await api.getStores('tenant/a', 'token-1'), []);
  assert.equal(calls[0].url, 'https://auth.example.test/organizations/tenant%2Fa/stores');
  assert.equal(new Headers(calls[0].init?.headers).get('authorization'), 'Bearer token-1');
});

test('production auth client rejects empty bearer tokens before network access', async () => {
  let called = false;
  const api = createProductionAuthApi('https://auth.example.test', async () => {
    called = true;
    return jsonResponse({});
  });

  assert.throws(() => api.logout('   '), /session token is required/i);
  assert.equal(called, false);
});

test('production auth client routes requireAdminRole logins to /auth/admin/login and surfaces 403 error message', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const api = createProductionAuthApi('https://auth.example.test', async (input, init) => {
    calls.push({ url: String(input), init });
    return jsonResponse(
      {
        error: {
          code: 'ADMIN_ROLE_REQUIRED',
          message: 'Access Denied: Only accounts with the "admin" role can authenticate into the Administrator Console.',
        },
      },
      403,
    );
  });

  await assert.rejects(
    () =>
      api.login({
        organizationSlug: 'prodx',
        storeCode: 'STR-01',
        registerId: 'ADMIN-CONSOLE',
        emailOrPin: 'cashier@prodx.co.th',
        passwordOrPin: '1111',
        requireAdminRole: true,
      }),
    /Only accounts with the "admin" role/i,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://auth.example.test/auth/admin/login');
});

