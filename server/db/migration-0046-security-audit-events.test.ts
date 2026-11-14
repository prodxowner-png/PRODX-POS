import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const migration = readFileSync(
  join(process.cwd(), 'db/migrations/0046_security_audit_events_append_only.sql'),
  'utf8',
);

test('0046 makes security audit events immutable and preserves historical identity references', () => {
  assert.match(migration, /DROP CONSTRAINT %I/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE ON public\.prodx_security_audit_events/);
  assert.match(migration, /ENABLE ALWAYS TRIGGER prodx_security_audit_events_immutable_guard/);
  assert.match(migration, /BEFORE TRUNCATE ON public\.prodx_security_audit_events/);
  assert.match(migration, /ENABLE ALWAYS TRIGGER prodx_security_audit_events_no_truncate_guard/);
  assert.match(migration, /organization_id and user_id are immutable historical identifiers/i);
  assert.match(migration, /prodx_record_supervisor_authorization_event[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = pg_catalog/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.prodx_record_supervisor_authorization_event[\s\S]*?TO prodx_app/i);
  assert.match(migration, /app\.organization_id/);
  assert.match(migration, /app\.store_id/);
  assert.match(migration, /app\.user_id/);
  assert.match(migration, /55000/);
  assert.match(migration, /security audit event user does not belong to the organization/);
  assert.match(migration, /security audit event organization does not exist/);
});
