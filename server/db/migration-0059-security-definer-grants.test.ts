import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const migration = readFileSync(join(process.cwd(), 'db/migrations/0059_security_revoke_api_role_security_definer.sql'), 'utf8');

test('0059 revokes PUBLIC and every provisioned Supabase API role', () => {
  const signatures = [
    'prodx_seed_discount_policy_for_store()',
    'prodx_auth_find_supervisor_by_supabase_subject(UUID, UUID, UUID)',
    'prodx_auth_find_supervisor_credential(UUID, UUID, TEXT)',
    'prodx_record_security_audit_event(UUID, UUID, UUID, TEXT, JSONB)',
  ];
  for (const signature of signatures) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      migration,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped} FROM PUBLIC`, 'i'),
      `missing PUBLIC revoke for ${signature}`,
    );
    assert.ok(migration.includes(`'${signature}'`), `missing conditional API-role revoke target for ${signature}`);
  }

  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.ok(migration.includes(`'${role}'`), `missing API role ${role}`);
  }
  assert.match(migration, /IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = api_role\)/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.%s FROM %I/i);

  for (const functionName of [
    'prodx_auth_find_supervisor_by_supabase_subject',
    'prodx_auth_find_supervisor_credential',
    'prodx_record_security_audit_event',
  ]) {
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${functionName}.*TO prodx_app`, 'i'));
  }
  assert.match(migration, /VALUES \('0059_security_revoke_api_role_security_definer'\)/i);
});
