import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const migration = readFileSync(join(process.cwd(), 'db/migrations/0060_security_revoke_runtime_trigger_function.sql'), 'utf8');

test('0060 revokes direct execution of the trigger-only SECURITY DEFINER function', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.prodx_seed_discount_policy_for_store\(\) FROM PUBLIC/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.prodx_seed_discount_policy_for_store\(\) FROM prodx_app/i);
  assert.match(migration, /VALUES \('0060_security_revoke_runtime_trigger_function'\)/i);
  assert.doesNotMatch(migration, /DROP FUNCTION|ALTER TABLE|DELETE FROM|TRUNCATE/i);
});
