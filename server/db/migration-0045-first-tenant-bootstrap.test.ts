import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const migration = readFileSync(join(process.cwd(), 'db/migrations/0045_m9_secure_first_tenant_bootstrap.sql'), 'utf8');

test('0045 first-tenant bootstrap is atomic, serialized, tenant-scoped, and least-privileged', () => {
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = pg_catalog/);
  assert.match(migration, /pg_advisory_xact_lock\(731904221, 45\)/);
  assert.match(migration, /supabase_auth_user_id = p_supabase_user_id/);
  assert.match(migration, /role_key = 'owner'/);
  assert.match(migration, /FROM public\.prodx_permissions/);
  assert.match(migration, /INSERT INTO public\.prodx_security_audit_events/);
  assert.match(migration, /'first_tenant_bootstrapped'/);
  assert.match(migration, /ON CONFLICT \(version\) DO NOTHING/);
  assert.match(migration, /FROM PUBLIC/);
  assert.match(migration, /TO prodx_app/);
  assert.match(migration, /'anon', 'authenticated', 'service_role'/);
  assert.doesNotMatch(migration, /CREATE POLICY|USING\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(migration, /lower\([^)]*email|email\s*=/i);
});
