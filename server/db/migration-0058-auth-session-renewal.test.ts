import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../db/migrations/0058_m8_supabase_pos_session_renewal.sql', import.meta.url),
  'utf8',
);

test('Supabase POS renewal migration keeps expiry monotonic and cannot revive expired or revoked sessions', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.prodx_auth_renew_supabase_session/);
  assert.match(migration, /RETURNS timestamptz/);
  assert.match(migration, /SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
  assert.match(migration, /GREATEST\(ses\.expires_at, p_expires_at\)/);
  assert.match(migration, /ses\.revoked_at IS NULL/);
  assert.match(migration, /ses\.expires_at > CURRENT_TIMESTAMP/);
  assert.match(migration, /p_expires_at > CURRENT_TIMESTAMP \+ INTERVAL '8 hours'/);
  assert.match(migration, /u\.supabase_auth_user_id = p_supabase_user_id/);
  assert.match(migration, /u\.status = 'active'/);
  assert.match(migration, /d\.status = 'active'/);
  assert.match(migration, /s\.active = TRUE/);
  assert.match(migration, /m\.active = TRUE/);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.prodx_sessions/i);
  assert.doesNotMatch(migration, /SET\s+token_hash\s*=/i);
});

test('Supabase POS renewal appends an audit event atomically only after a successful session update', () => {
  assert.match(migration, /RETURNING ses\.expires_at, ses\.user_id, ses\.organization_id[\s\S]*?INTO renewed_expiry, renewed_user_id, renewed_organization_id/);
  assert.match(migration, /IF renewed_expiry IS NOT NULL THEN[\s\S]*?INSERT INTO public\.prodx_security_audit_events/);
  assert.match(migration, /'POS_SESSION_RENEWED'/);
  assert.match(migration, /'session_id', p_session_id/);
  assert.match(migration, /'expires_at', renewed_expiry/);
  assert.match(migration, /END IF;\s*RETURN renewed_expiry;/);
});

test('Supabase POS renewal RPC is executable only by the backend runtime role', () => {
  assert.match(migration, /REVOKE ALL PRIVILEGES ON FUNCTION public\.prodx_auth_renew_supabase_session[\s\S]*?FROM PUBLIC/);
  assert.ok(migration.includes("ARRAY['anon', 'authenticated', 'service_role']"));
  assert.ok(migration.includes("'anon'"));
  assert.ok(migration.includes("'authenticated'"));
  assert.ok(migration.includes("'service_role'"));
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.prodx_auth_renew_supabase_session[\s\S]*?TO prodx_app/);
  assert.match(migration, /0058_m8_supabase_pos_session_renewal/);
});
