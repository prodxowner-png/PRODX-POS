import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const migration = readFileSync(
  join(process.cwd(), 'db/migrations/0048_supervisor_credential_store_membership.sql'),
  'utf8',
);

test('0048 scopes supervisor credential lookup and lockout mutation to active tenant/store membership', () => {
  assert.equal((migration.match(/CREATE OR REPLACE FUNCTION public\.prodx_supervisor_/g) ?? []).length, 3);
  assert.match(migration, /requester_membership\.store_id = p_store_id/);
  assert.match(migration, /requester_membership\.active = TRUE/);
  assert.match(migration, /requester\.status = 'active'/);
  assert.match(migration, /target_membership\.store_id = p_store_id/);
  assert.match(migration, /target_membership\.active = TRUE/);
  assert.match(migration, /u\.status = 'active'/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*?SET search_path = pg_catalog/);
  assert.match(migration, /REVOKE ALL ON FUNCTION %s FROM PUBLIC/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION %s TO prodx_app/);
  assert.match(migration, /0048_supervisor_credential_store_membership/);
  assert.doesNotMatch(migration, /GRANT\s+SELECT\s+ON\s+(?:TABLE\s+)?public\.prodx_user_credentials\s+TO\s+prodx_app/i);
});
