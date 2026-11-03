import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('Migration 0040 restricts Supabase identity lookup to the backend runtime role', () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), 'db/migrations/0040_security_restrict_identity_lookup_execute.sql'),
    'utf8',
  );

  assert.match(migration, /to_regprocedure\('public\.prodx_auth_find_credential_by_supabase_user_id\(uuid, uuid\)'\) IS NULL/i);
  assert.match(migration, /REVOKE ALL PRIVILEGES\s+ON FUNCTION public\.prodx_auth_find_credential_by_supabase_user_id\(uuid, uuid\)\s+FROM PUBLIC;/i);
  assert.match(migration, /FOREACH role_name IN ARRAY ARRAY\['anon', 'authenticated', 'service_role'\]/i);
  assert.match(migration, /IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = role_name\)/i);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON FUNCTION public\.prodx_auth_find_credential_by_supabase_user_id\(uuid, uuid\) FROM %I/i);
  assert.match(migration, /GRANT EXECUTE\s+ON FUNCTION public\.prodx_auth_find_credential_by_supabase_user_id\(uuid, uuid\)\s+TO prodx_app;/i);
  assert.match(migration, /ALTER FUNCTION public\.prodx_auth_find_credential_by_supabase_user_id\(uuid, uuid\)\s+SET search_path = pg_catalog;/i);
  assert.match(migration, /VALUES\s*\('0040_security_restrict_identity_lookup_execute'\)/i);
});
