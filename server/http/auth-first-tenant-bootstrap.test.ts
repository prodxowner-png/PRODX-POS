import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import { readFirstTenantBootstrapConfig } from '../auth/first-tenant-bootstrap';
import type { SessionIssuer } from '../auth/session';
import type { FirstTenantBootstrapRepository, SqlExecutor } from '../auth/postgres-repository';
import { registerAuthRoutes } from './auth-route';

const subjectId = '00000000-0000-4000-8000-000000000001';
const ids = {
  organizationId: '00000000-0000-4000-8000-000000000011',
  storeId: '00000000-0000-4000-8000-000000000012',
  userId: '00000000-0000-4000-8000-000000000013',
  roleId: '00000000-0000-4000-8000-000000000014',
  deviceId: '00000000-0000-4000-8000-000000000015',
};
const config = readFirstTenantBootstrapConfig({
  PRODX_FIRST_TENANT_BOOTSTRAP_SECRET: 'test-bootstrap-secret-with-more-than-32-bytes',
  PRODX_FIRST_TENANT_BOOTSTRAP_SUBJECT: subjectId,
  PRODX_FIRST_TENANT_ORGANIZATION_CODE: 'PRODX',
  PRODX_FIRST_TENANT_ORGANIZATION_NAME: 'PRODX Organization',
  PRODX_FIRST_TENANT_STORE_CODE: 'STR-01',
  PRODX_FIRST_TENANT_STORE_NAME: 'สำนักงานใหญ่',
  PRODX_FIRST_TENANT_STORE_TIMEZONE: 'Asia/Bangkok',
  PRODX_FIRST_TENANT_OWNER_USERNAME: 'owner@example.invalid',
  PRODX_FIRST_TENANT_OWNER_DISPLAY_NAME: 'First Owner',
  PRODX_FIRST_TENANT_DEVICE_KEY: 'ADMIN-CONSOLE',
  PRODX_FIRST_TENANT_DEVICE_NAME: 'Administrator Console',
});
assert.ok(config);

test('first-tenant bootstrap HTTP boundary requires operator secret and allowlisted verified Supabase subject', async (t) => {
  let verifyCalls = 0;
  let bootstrapCalls = 0;
  let receivedInput: Record<string, unknown> | null = null;
  const repository: FirstTenantBootstrapRepository = {
    async bootstrapFirstTenant(input) {
      bootstrapCalls += 1;
      receivedInput = input;
      return { ...ids };
    },
  };
  const db: SqlExecutor = {
    async query<T extends Record<string, unknown>>(sql: string): Promise<readonly T[]> {
      if (sql.includes('SELECT o.id AS organization_id')) {
        return [{
          organization_id: ids.organizationId,
          organization_code: 'PRODX',
          organization_name: 'PRODX Organization',
          store_id: ids.storeId,
          store_code: 'STR-01',
          store_name: 'สำนักงานใหญ่',
          business_timezone: 'Asia/Bangkok',
          user_id: ids.userId,
          username: 'owner@example.invalid',
          display_name: 'First Owner',
          role_key: 'owner',
          device_key: 'ADMIN-CONSOLE',
        }] as unknown as readonly T[];
      }
      if (sql.includes('SELECT DISTINCT p.permission_key')) {
        return [{ permission_key: 'rbac.manage' }, { permission_key: 'users.manage' }] as unknown as readonly T[];
      }
      throw new Error('Unexpected SQL in bootstrap route test.');
    },
  };
  const sessions: SessionIssuer = {
    async authenticateCredentials() { return null; },
    async authenticateSupabaseToken(input) {
      assert.equal(input.deviceId, ids.deviceId);
      return { token: 'pos-session-token', sessionId: 'session-id', expiresAt: new Date(Date.now() + 60_000) };
    },
    async authenticateBearer(token) {
      assert.equal(token, 'pos-session-token');
      return {
        sessionId: 'session-id',
        userId: ids.userId,
        organizationId: ids.organizationId,
        storeId: ids.storeId,
      };
    },
    async revokeBearer() { return true; },
  };

  const app = express();
  app.use(express.json());
  registerAuthRoutes(app, db, sessions, {
    firstTenantBootstrap: {
      config,
      repository,
      verifySupabaseIdentity: async () => {
        verifyCalls += 1;
        return { userId: subjectId, expiresAt: new Date(Date.now() + 60_000) };
      },
    },
  });
  const server = app.listen(0);
  t.after(async () => new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/auth/supabase/bootstrap`;

  const wrongSecret = await fetch(url, {
    method: 'POST',
    headers: { authorization: 'Bearer supabase-jwt', 'x-prodx-bootstrap-secret': 'wrong' },
  });
  assert.equal(wrongSecret.status, 401);
  assert.equal(verifyCalls, 0);
  assert.equal(bootstrapCalls, 0);

  const wrongSubjectApp = express();
  wrongSubjectApp.use(express.json());
  registerAuthRoutes(wrongSubjectApp, db, sessions, {
    firstTenantBootstrap: {
      config,
      repository,
      verifySupabaseIdentity: async () => ({
        userId: '00000000-0000-4000-8000-000000000099',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    },
  });
  const wrongSubjectServer = wrongSubjectApp.listen(0);
  t.after(async () => new Promise<void>((resolve, reject) => {
    wrongSubjectServer.close((error?: Error) => error ? reject(error) : resolve());
  }));
  const wrongSubjectAddress = wrongSubjectServer.address();
  assert.ok(wrongSubjectAddress && typeof wrongSubjectAddress === 'object');
  const wrongSubject = await fetch(`http://127.0.0.1:${wrongSubjectAddress.port}/auth/supabase/bootstrap`, {
    method: 'POST',
    headers: { authorization: 'Bearer supabase-jwt', 'x-prodx-bootstrap-secret': config.secret },
  });
  assert.equal(wrongSubject.status, 401);
  assert.equal(bootstrapCalls, 0);

  const success = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: 'Bearer supabase-jwt',
      'x-prodx-bootstrap-secret': config.secret,
      'content-type': 'application/json',
    },
    // Client-selected tenant/device values are ignored; only server config is used.
    body: JSON.stringify({ organizationCode: 'attacker-org', storeCode: 'attacker-store', deviceId: 'attacker-device' }),
  });
  assert.equal(success.status, 200);
  assert.equal(success.headers.get('cache-control'), 'private, no-store');
  const context = await success.json() as { organization: { slug: string }; currentStore: { id: string }; currentUser: { role: string } };
  assert.equal(context.organization.slug, 'PRODX');
  assert.equal(context.currentStore.id, ids.storeId);
  assert.equal(context.currentUser.role, 'admin');
  assert.equal(bootstrapCalls, 1);
  assert.deepEqual(receivedInput, {
    supabaseUserId: subjectId,
    organizationCode: 'PRODX',
    organizationName: 'PRODX Organization',
    storeCode: 'STR-01',
    storeName: 'สำนักงานใหญ่',
    businessTimezone: 'Asia/Bangkok',
    ownerUsername: 'owner@example.invalid',
    ownerDisplayName: 'First Owner',
    deviceKey: 'ADMIN-CONSOLE',
    deviceName: 'Administrator Console',
  });
});
