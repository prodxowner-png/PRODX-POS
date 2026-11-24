import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const migration = readFileSync(join(process.cwd(), 'db/migrations/0059_security_revoke_api_role_security_definer.sql'), 'utf8');

test('0059 revokes SECURITY DEFINER execution from every Supabase API role', () => {
  const signatures = [
    /prodx_seed_discount_policy_for_store\(\)/i,
    /prodx_auth_find_supervisor_by_supabase_subject\(UUID, UUID, UUID\)/i,
    /prodx_auth_find_supervisor_credential\(UUID, UUID, TEXT\)/i,
    /prodx_record_security_audit_event\(UUID, UUID, UUID, TEXT, JSONB\)/i,
  ];
  for (const signature of signatures) {
    const declaration = migration.split(';').find((statement) => /REVOKE ALL ON FUNCTION/i.test(statement) && signature.test(statement));
    assert.ok(declaration, `missing explicit API-role revoke for ${signature}`);
    assert.match(declaration, /FROM PUBLIC, anon, authenticated, service_role/i);
  }
  for (const functionName of [
    'prodx_auth_find_supervisor_by_supabase_subject',
    'prodx_auth_find_supervisor_credential',
    'prodx_record_security_audit_event',
  ]) {
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${functionName}.*TO prodx_app`, 'i'));
  }
  assert.match(migration, /VALUES \('0059_security_revoke_api_role_security_definer'\)/i);
});
