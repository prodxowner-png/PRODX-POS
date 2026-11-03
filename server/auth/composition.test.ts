import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresAuthentication } from './composition';
import { hashSessionToken } from './session';
import { hashPassword } from './password';
import type { SqlExecutor } from './postgres-repository';

const makeDb = (passwordHash: string, calls: string[]): SqlExecutor => ({
  async query<T extends Record<string, unknown>>(sql: string, parameters = []): Promise<readonly T[]> {
    calls.push(`${sql}\n${JSON.stringify(parameters)}`);
    if (sql.includes('prodx_auth_find_credential_by_username')) {
      const row = {
        userId: 'user-1', organizationId: 'org-1', username: 'cashier', status: 'active',
        credential_type: 'password', secret_hash: passwordHash, failed_attempts: 0, locked_until: null,
      };
      return [row as unknown as T];
    }
    if (sql.includes('prodx_auth_find_device')) {
      const row = { id: 'device-1', organization_id: 'org-1', store_id: 'store-1', status: 'active' };
      return [row as unknown as T];
    }
    return [];
  },
});

test('application composition builds authentication against the injected PostgreSQL boundary', async () => {
  const calls: string[] = [];
  const passwordHash = await hashPassword('correct-password');
  const authentication = createPostgresAuthentication(
    makeDb(passwordHash, calls),
    async () => ({ compromised: false, count: 0 }),
  );

  const result = await authentication.authenticateCredentials({
    username: 'cashier',
    password: 'correct-password',
    deviceId: 'device-1',
  });

  assert.ok(result);
  assert.equal(calls.some((call) => call.includes('prodx_auth_create_session')), true);
  assert.equal(calls.some((call) => call.includes(result.token)), false);
  assert.equal(calls.some((call) => call.includes(hashSessionToken(result.token))), true);
});
