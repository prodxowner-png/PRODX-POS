import assert from 'node:assert/strict';
import express from 'express';
import test, { type TestContext } from 'node:test';
import { registerWebAuthnRoutes } from './webauthn-route.ts';
import type { SqlExecutor } from '../auth/postgres-repository.ts';
import type { SessionIssuer } from '../auth/session.ts';

const withServer = async (work: (baseUrl: string) => Promise<void>) => {
  const app = express();
  app.use(express.json());
  const db: SqlExecutor = { query: async () => { throw new Error('Unexpected database access in boundary test.'); } };
  const sessions = {
    authenticateCredentials: async () => null,
    authenticateSupabaseToken: async () => null,
    authenticateBearer: async () => null,
    renewSupabaseSession: async () => null,
    revokeBearer: async () => false,
  } as SessionIssuer;
  registerWebAuthnRoutes(app, db, sessions);
  const server = app.listen(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await work(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

const restoreEnv = (t: TestContext) => {
  const previous = {
    rpId: process.env.WEBAUTHN_RP_ID,
    rpName: process.env.WEBAUTHN_RP_NAME,
    origin: process.env.WEBAUTHN_ORIGIN,
  };
  t.after(() => {
    if (previous.rpId === undefined) delete process.env.WEBAUTHN_RP_ID; else process.env.WEBAUTHN_RP_ID = previous.rpId;
    if (previous.rpName === undefined) delete process.env.WEBAUTHN_RP_NAME; else process.env.WEBAUTHN_RP_NAME = previous.rpName;
    if (previous.origin === undefined) delete process.env.WEBAUTHN_ORIGIN; else process.env.WEBAUTHN_ORIGIN = previous.origin;
  });
};

test('WebAuthn status fails closed when relying-party configuration is absent', async (t) => {
  restoreEnv(t);
  delete process.env.WEBAUTHN_RP_ID;
  delete process.env.WEBAUTHN_ORIGIN;
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/webauthn/status`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      enabled: false,
      rpId: null,
      error: 'WebAuthn RP ID and exact allowed origins are not configured.',
    });
    const options = await fetch(`${baseUrl}/auth/webauthn/login/options`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    });
    assert.equal(options.status, 503);
  });
});

test('WebAuthn rejects untrusted origins before database access', async (t) => {
  restoreEnv(t);
  process.env.WEBAUTHN_RP_ID = 'localhost';
  process.env.WEBAUTHN_ORIGIN = 'http://localhost:5173';
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/webauthn/login/options`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.localhost:5173' },
      body: JSON.stringify({ organizationSlug: 'acme', storeCode: 'main', registerId: 'pos-1', username: 'cashier' }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'WEBAUTHN_ORIGIN_REJECTED');
  });
});

test('WebAuthn registration endpoints require a server-issued bearer session', async (t) => {
  restoreEnv(t);
  process.env.WEBAUTHN_RP_ID = 'localhost';
  process.env.WEBAUTHN_ORIGIN = 'http://localhost:5173';
  await withServer(async (baseUrl) => {
    const headers = { 'content-type': 'application/json', origin: 'http://localhost:5173' };
    const options = await fetch(`${baseUrl}/auth/webauthn/registration/options`, { method: 'POST', headers, body: JSON.stringify({ label: 'Laptop' }) });
    assert.equal(options.status, 401);
    const verify = await fetch(`${baseUrl}/auth/webauthn/registration/verify`, { method: 'POST', headers, body: JSON.stringify({ challengeId: '00000000-0000-4000-8000-000000000001', response: {} }) });
    assert.equal(verify.status, 401);
    const credentials = await fetch(`${baseUrl}/auth/webauthn/credentials`, { headers: { origin: 'http://localhost:5173' } });
    assert.equal(credentials.status, 401);
  });
});

test('credential management endpoints reject untrusted origins before bearer/database access', async (t) => {
  restoreEnv(t);
  process.env.WEBAUTHN_RP_ID = 'localhost';
  process.env.WEBAUTHN_ORIGIN = 'http://localhost:5173';
  await withServer(async (baseUrl) => {
    for (const [path, method] of [
      ['/auth/webauthn/credentials', 'GET'],
      ['/auth/webauthn/credentials/00000000-0000-4000-8000-000000000001', 'PATCH'],
      ['/auth/webauthn/credentials/00000000-0000-4000-8000-000000000001', 'DELETE'],
    ] as const) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { origin: 'http://evil.localhost:5173', authorization: 'Bearer dummy' },
      });
      assert.equal(response.status, 403, `${method} ${path} must reject untrusted origin`);
    }
  });
});

test('WebAuthn login verification rejects malformed challenge IDs before database access', async (t) => {
  restoreEnv(t);
  process.env.WEBAUTHN_RP_ID = 'localhost';
  process.env.WEBAUTHN_ORIGIN = 'http://localhost:5173';
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/webauthn/login/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify({ challengeId: 'not-a-uuid', response: { id: 'credential', response: {} } }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'WEBAUTHN_REQUEST_INVALID');
  });
});
