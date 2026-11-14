import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import type { SessionIssuer } from '../auth/session';
import type { SqlExecutor } from '../auth/postgres-repository';
import { registerAuthRoutes } from './auth-route';

const device = {
  id: '00000000-0000-4000-8000-000000000015',
  store_id: '00000000-0000-4000-8000-000000000012',
};

const createHarness = (supabaseSessionEnabled?: boolean) => {
  let databaseCalls = 0;
  let exchangeCalls = 0;
  const db: SqlExecutor = {
    async query<T extends Record<string, unknown>>(sql: string): Promise<readonly T[]> {
      databaseCalls += 1;
      if (sql.includes('prodx_auth_resolve_device')) return [device as unknown as T];
      throw new Error('Unexpected SQL in Supabase session opt-in test.');
    },
  };
  const sessions = {
    async authenticateCredentials() { return null; },
    async authenticateSupabaseToken() { exchangeCalls += 1; return null; },
    async authenticateBearer() { return null; },
    async revokeBearer() { return false; },
  } as unknown as SessionIssuer;

  const app = express();
  app.use(express.json());
  registerAuthRoutes(app, db, sessions, { supabaseSessionEnabled });
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    url: `http://127.0.0.1:${address.port}/auth/supabase/session`,
    server,
    get databaseCalls() { return databaseCalls; },
    get exchangeCalls() { return exchangeCalls; },
  };
};

test('Supabase POS session exchange is disabled by default even when a caller supplies a valid-shaped request', async (t) => {
  const harness = createHarness();
  t.after(async () => new Promise<void>((resolve, reject) => {
    harness.server.close((error?: Error) => error ? reject(error) : resolve());
  }));

  const response = await fetch(harness.url, {
    method: 'POST',
    headers: {
      authorization: 'Bearer supabase-access-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      organizationSlug: 'PRODX',
      storeCode: 'STR-01',
      registerId: 'ADMIN-CONSOLE',
    }),
  });

  assert.equal(response.status, 404);
  assert.equal(harness.databaseCalls, 0);
  assert.equal(harness.exchangeCalls, 0);
});

test('Supabase POS session exchange is reachable only when the server rollout flag is explicitly true', async (t) => {
  const harness = createHarness(true);
  t.after(async () => new Promise<void>((resolve, reject) => {
    harness.server.close((error?: Error) => error ? reject(error) : resolve());
  }));

  const response = await fetch(harness.url, {
    method: 'POST',
    headers: {
      authorization: 'Bearer supabase-access-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      organizationSlug: 'PRODX',
      storeCode: 'STR-01',
      registerId: 'ADMIN-CONSOLE',
    }),
  });

  // The fake issuer rejects the token after device resolution; this proves the
  // route was enabled without manufacturing a POS session in the test.
  assert.equal(response.status, 401);
  assert.equal(harness.databaseCalls, 1);
  assert.equal(harness.exchangeCalls, 1);
});
