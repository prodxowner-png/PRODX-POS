import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import type { SessionIssuer } from '../auth/session';
import type { SqlExecutor } from '../auth/postgres-repository';
import { registerAuthRoutes } from './auth-route';

test('Supabase renewal HTTP route requires both bearer credentials and returns server-resolved session context', async (t) => {
  const expiry = new Date('2030-01-01T01:00:00.000Z');
  const renewalCalls: Array<{ supabaseToken: string; posToken: string }> = [];
  const queryCalls: string[] = [];
  const principal = {
    sessionId: '00000000-0000-4000-8000-000000000101',
    userId: '00000000-0000-4000-8000-000000000102',
    organizationId: '00000000-0000-4000-8000-000000000103',
    storeId: '00000000-0000-4000-8000-000000000104',
  };
  const db: SqlExecutor = {
    async query<T extends Record<string, unknown>>(sql: string): Promise<readonly T[]> {
      queryCalls.push(sql);
      if (sql.includes('FROM prodx_sessions ses')) {
        return [{
          organization_id: principal.organizationId,
          organization_code: 'test-org',
          organization_name: 'Test Organization',
          store_id: principal.storeId,
          store_code: 'store-01',
          store_name: 'Test Store',
          business_timezone: 'Asia/Bangkok',
          user_id: principal.userId,
          username: 'cashier@example.test',
          display_name: 'Test Cashier',
          role_key: 'cashier',
          device_key: 'register-01',
        } as unknown as T];
      }
      if (sql.includes('SELECT DISTINCT p.permission_key')) {
        return [{ permission_key: 'pos.sell' } as unknown as T];
      }
      return [];
    },
  };
  const sessions = {
    renewSupabaseSession: async (input: { supabaseToken: string; posToken: string }) => {
      renewalCalls.push(input);
      return { expiresAt: expiry };
    },
    authenticateBearer: async (token: string) => token === 'pos-bearer' ? principal : null,
  } as unknown as SessionIssuer;

  const app = express();
  app.use(express.json());
  registerAuthRoutes(app, db, sessions);
  const server = app.listen(0);
  t.after(async () => new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = 'http://127.0.0.1:' + address.port;

  const missingSupabase = await fetch(baseUrl + '/auth/supabase/renew', {
    method: 'POST',
    headers: { authorization: 'Bearer pos-bearer' },
  });
  assert.equal(missingSupabase.status, 401);
  assert.equal(renewalCalls.length, 0);
  assert.equal(queryCalls.length, 0);

  const renewed = await fetch(baseUrl + '/auth/supabase/renew', {
    method: 'POST',
    headers: {
      authorization: 'Bearer pos-bearer',
      'x-supabase-authorization': 'Bearer refreshed-supabase-jwt',
    },
  });
  assert.equal(renewed.status, 200);
  assert.equal(renewed.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(renewalCalls, [{
    supabaseToken: 'refreshed-supabase-jwt',
    posToken: 'pos-bearer',
  }]);
  const context = await renewed.json() as {
    token: string;
    expiresAt: string;
    currentUser: { id: string; permissions: readonly string[] };
  };
  assert.equal(context.token, 'pos-bearer');
  assert.equal(context.expiresAt, expiry.toISOString());
  assert.equal(context.currentUser.id, principal.userId);
  assert.deepEqual(context.currentUser.permissions, ['pos:checkout']);
  assert.equal(queryCalls.length, 2);
});
