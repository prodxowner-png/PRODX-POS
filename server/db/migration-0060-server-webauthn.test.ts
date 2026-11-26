import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const migration = readFileSync(join(process.cwd(), 'db/migrations/0060_m11_server_webauthn.sql'), 'utf8');
const route = readFileSync(join(process.cwd(), 'server/http/webauthn-route.ts'), 'utf8');

test('0060 stores credentials and single-use challenges under forced RLS without direct runtime grants', () => {
  for (const table of ['prodx_webauthn_credentials', 'prodx_webauthn_challenges']) {
    assert.match(migration, new RegExp(`CREATE TABLE public\\.${table}`, 'i'));
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, 'i'));
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY`, 'i'));
  }
  assert.match(migration, /REVOKE ALL ON TABLE public\.prodx_webauthn_credentials, public\.prodx_webauthn_challenges FROM PUBLIC/i);
  assert.match(migration, /REVOKE ALL ON TABLE public\.prodx_webauthn_credentials, public\.prodx_webauthn_challenges FROM prodx_app/i);
  assert.match(migration, /ARRAY\['anon', 'authenticated', 'service_role'\]/i);
  assert.doesNotMatch(migration, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[\s\S]{0,160}prodx_webauthn_(?:credentials|challenges)[\s\S]{0,80}TO\s+prodx_app/i);
});

test('0060 exposes only narrow server RPCs and preserves the append-only audit ledger', () => {
  const functions = [
    'prodx_webauthn_resolve_login', 'prodx_webauthn_list_login_credentials', 'prodx_webauthn_resolve_registration',
    'prodx_webauthn_issue_challenge', 'prodx_webauthn_get_challenge',
    'prodx_webauthn_get_auth_credential', 'prodx_webauthn_record_failed_attempt', 'prodx_webauthn_complete_authentication',
    'prodx_webauthn_list_credentials', 'prodx_webauthn_complete_registration',
    'prodx_webauthn_fail_registration', 'prodx_webauthn_rename_credential', 'prodx_webauthn_revoke_credential',
  ];
  for (const name of functions) {
    assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`, 'i'));
    assert.ok(migration.includes(`'${name}(`), `missing least-privilege grant/revoke target for ${name}`);
  }
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.%s FROM PUBLIC/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.%s TO prodx_app/i);
  assert.match(migration, /INSERT INTO public\.prodx_security_audit_events/i);
  assert.match(migration, /session_id uuid REFERENCES public\.prodx_sessions\(id\)/i);
  assert.match(migration, /v_ch\.session_id IS DISTINCT FROM p_session_id/i);
  assert.match(migration, /prodx_webauthn_revoke_credential\(uuid,text\)/i);
  assert.match(migration, /jsonb_build_object\('reason', p_reason\)/i);
  assert.match(migration, /jsonb_build_object\('previousLabel', v_previous_label, 'newLabel'/i);
  assert.doesNotMatch(migration, /UPDATE\s+public\.prodx_security_audit_events|DELETE\s+FROM\s+public\.prodx_security_audit_events|TRUNCATE\s+public\.prodx_security_audit_events/i);
  assert.match(migration, /VALUES \('0060_m11_server_webauthn'\)/i);
});

test('WebAuthn routes verify server challenges, RP ID, exact origins and user verification', () => {
  assert.match(route, /verifyAuthenticationResponse/);
  assert.match(route, /verifyRegistrationResponse/);
  assert.match(route, /expectedChallenge:\s*challenge\.challenge/);
  assert.match(route, /expectedOrigin:\s*config\.origins/);
  assert.match(route, /expectedRPID:\s*config\.rpId/);
  assert.match(route, /requireUserVerification:\s*true/);
  assert.match(route, /hashSessionToken\(token\)/);
  assert.match(route, /prodx_webauthn_resolve_registration/);
  assert.doesNotMatch(route, /FROM public\.prodx_(?:sessions|users|devices|store_memberships)\b/i);
});
