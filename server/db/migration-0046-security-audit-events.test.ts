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
  assert.match(migration, /BEFORE UPDATE OR DELETE ON public\.prodx_security_audit_events/);
  assert.match(migration, /ENABLE ALWAYS TRIGGER prodx_security_audit_events_immutable_guard/);
  assert.match(migration, /organization_id and user_id are immutable historical identifiers/i);
  assert.doesNotMatch(migration, /SECURITY DEFINER/i);
  assert.match(migration, /55000/);
});
