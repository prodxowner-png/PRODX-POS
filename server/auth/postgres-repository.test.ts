import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresAuthenticationRepository, type SqlExecutor } from './postgres-repository';

test('Supabase principal lookup uses the password-independent explicit UUID RPC', async () => {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const db: SqlExecutor = {
    async query<T extends Record<string, unknown>>(sql: string, parameters = []): Promise<readonly T[]> {
      calls.push({ sql, parameters });
      return [{ userId: 'user-1', organizationId: 'org-1', username: 'cashier', status: 'active' } as unknown as T];
    },
  };
  const result = await createPostgresAuthenticationRepository(db).findUserBySupabaseUserId(
    '00000000-0000-4000-8000-000000000099', '00000000-0000-4000-8000-000000000100',
  );
  assert.deepEqual(result, { userId: 'user-1', organizationId: 'org-1', username: 'cashier', status: 'active' });
  assert.deepEqual(calls[0].parameters, ['00000000-0000-4000-8000-000000000099', '00000000-0000-4000-8000-000000000100']);
  assert.match(calls[0].sql, /prodx_auth_find_user_by_supabase_user_id/);
  assert.doesNotMatch(calls[0].sql, /prodx_user_credentials|secret_hash/);
});

test('credential lookup maps authoritative user and credential state', async () => {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const db: SqlExecutor = {
    async query<T extends Record<string, unknown>>(sql: string, parameters = []): Promise<readonly T[]> {
      calls.push({ sql, parameters });
      const row = { userId: 'user-1', organizationId: 'org-1', username: 'cashier', status: 'active',
        credential_type: 'password', secret_hash: 'scrypt$hash', failed_attempts: 2, locked_until: null };
      return [row as unknown as T];
    },
  };
  const repository = createPostgresAuthenticationRepository(db);
  const result = await repository.findCredentialByUsername('cashier', 'device-1');
  assert.deepEqual(result, { userId: 'user-1', organizationId: 'org-1', username: 'cashier', status: 'active',
    credentialType: 'password', secretHash: 'scrypt$hash', failedAttempts: 2, lockedUntil: null });
  assert.deepEqual(calls[0].parameters, ['cashier', 'device-1']);
  assert.match(calls[0].sql, /prodx_auth_find_credential_by_username/);
});

test('credential lookup is scoped to the requested organization', async () => {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const db: SqlExecutor = {
    async query<T extends Record<string, unknown>>(sql: string, parameters = []): Promise<readonly T[]> {
      calls.push({ sql, parameters });
      return [];
    },
  };
  assert.equal(await createPostgresAuthenticationRepository(db).findCredentialByUsername('cashier', 'device-2'), null);
  assert.deepEqual(calls[0].parameters, ['cashier', 'device-2']);
  assert.match(calls[0].sql, /prodx_auth_find_credential_by_username/);
});

test('session revocation only revokes active sessions', async () => {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const db: SqlExecutor = {
    async query<T extends Record<string, unknown>>(sql: string, parameters = []): Promise<readonly T[]> {
      calls.push({ sql, parameters });
      return [];
    },
  };
  const at = new Date('2030-01-01T00:00:00Z');
  await createPostgresAuthenticationRepository(db).revokeSession('session-1', 'token-hash', at);
  assert.deepEqual(calls[0].parameters, ['session-1', 'token-hash', at]);
  assert.match(calls[0].sql, /prodx_auth_revoke_session/);
});

test('Supabase POS session renewal uses the atomic database function and returns its persisted expiry', async () => {
  const expiry = new Date('2030-01-01T00:00:00Z');
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const db: SqlExecutor = {
    async query<T extends Record<string, unknown>>(sql: string, parameters = []): Promise<readonly T[]> {
      calls.push({ sql, parameters });
      return [{ expires_at: expiry } as unknown as T];
    },
  };
  const result = await createPostgresAuthenticationRepository(db).renewSession({
    sessionId: 'session-1',
    tokenHash: 'hashed-token',
    supabaseUserId: 'supabase-user-1',
    expiresAt: expiry,
  });
  assert.equal(result, expiry);
  assert.deepEqual(calls[0].parameters, ['session-1', 'hashed-token', 'supabase-user-1', expiry]);
  assert.match(calls[0].sql, /prodx_auth_renew_supabase_session/);
  assert.doesNotMatch(calls[0].sql, /UPDATE\s+prodx_sessions/i);
});

test('session lookup joins user status instead of trusting session state', async () => {
  const db: SqlExecutor = { async query<T extends Record<string, unknown>>(): Promise<readonly T[]> {
    return [{ id: 'session-1', organization_id: 'org-1', user_id: 'user-1', device_id: 'device-1',
      token_hash: 'hash', expires_at: new Date('2030-01-01T00:00:00Z'), revoked_at: null, user_status: 'active' } as unknown as T];
  }};
  const result = await createPostgresAuthenticationRepository(db).findSessionByTokenHash('hash');
  assert.equal(result?.userStatus, 'active');
  assert.equal(result?.organizationId, 'org-1');
  assert.equal(result?.tokenHash, 'hash');
});

test('credential and session writes remain parameterized and persist auth security events atomically', async () => {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const db: SqlExecutor = { async query<T extends Record<string, unknown>>(sql: string, parameters = []): Promise<readonly T[]> {
    calls.push({ sql, parameters }); return [];
  }};
  const repository = createPostgresAuthenticationRepository(db);
  await repository.createSession({ id: 'session-1', organizationId: 'org-1', userId: 'user-1', deviceId: 'device-1', tokenHash: 'token-hash', expiresAt: new Date('2030-01-01T00:00:00Z') });
  await repository.recordFailedAttempt('user-1', 'org-1');
  await repository.resetFailedAttempts('user-1', 'org-1');
  await repository.touchSession('session-1', 'token-hash', new Date('2030-01-01T00:00:00Z'));
  assert.equal(calls.length, 4);
  assert.ok(calls.every(({ sql }) => !sql.includes('token-hash')));
  assert.equal(calls[1].parameters[0], 'user-1');
  assert.equal(calls[1].parameters[1], 'org-1');
  assert.equal(calls[1].parameters.length, 3);
  assert.match(calls[1].sql, /prodx_auth_record_failed_attempt/);
  assert.match(calls[2].sql, /prodx_auth_reset_failed_attempts/);
  assert.equal(calls[2].parameters.length, 3);
  assert.match(calls[3].sql, /prodx_auth_touch_session/);
});
