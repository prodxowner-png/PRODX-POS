import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../db/migrations/0059_security_harden_discount_authorization_rpcs.sql', import.meta.url),
  'utf8',
);

test('password supervisor reset supports the distinct discount approval permission', () => {
  assert.match(migration, /WHEN 'discount' THEN 'pos\.discount\.approve'/);
});

test('supervisor lookup RPCs require the authenticated requester membership and pin search_path', () => {
  assert.match(migration, /prodx_auth_find_supervisor_by_supabase_subject[\s\S]*?SET search_path = pg_catalog[\s\S]*?app\.user_id/);
  assert.match(migration, /prodx_auth_find_supervisor_credential[\s\S]*?SET search_path = pg_catalog[\s\S]*?app\.user_id/);
});

test('security audit writes are limited to known event contracts and trusted store actors', () => {
  assert.match(migration, /p_event_type IS NULL OR p_event_type NOT IN/);
  assert.match(migration, /jsonb_object_keys\(p_metadata\)/);
  assert.match(migration, /security audit requester does not match authenticated user/);
  assert.match(migration, /security audit actor is not an active member of the authenticated store/);
  assert.equal(migration.includes('prodx_supervisor_authorizations authorization'), false);
  assert.match(migration, /discount authorization grant has no matching persisted authorization/);
  assert.match(migration, /consumed supervisor authorization has no matching persisted grant/);
  assert.match(migration, /discount policy audit event does not match persisted policy state/);
});

test('disabled supervisor rejection preserves target identity without accepting it as an audit actor', () => {
  const lookupStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.prodx_supervisor_find_credential(');
  const lookupEnd = migration.indexOf('$function$;', lookupStart);
  const lookup = lookupStart >= 0 && lookupEnd >= 0
    ? migration.slice(lookupStart, lookupEnd + '$function$;'.length)
    : '';
  assert.ok(lookup, 'migration must replace the backend credential lookup RPC');
  assert.ok(lookup.includes('target_membership.active = TRUE'));
  assert.equal(lookup.includes("u.status = 'active'"), false);
  assert.ok(migration.includes("'requestedSupervisorUserId'"));
  assert.ok(migration.includes("p_user_id IS NULL AND p_event_type <> 'SUPERVISOR_AUTH_REJECTED'"));
  assert.ok(migration.includes("actor.status = 'active'"));
  assert.ok(migration.includes('REVOKE ALL ON FUNCTION public.prodx_supervisor_find_credential(uuid, uuid, text) FROM PUBLIC'));
  assert.ok(migration.includes('GRANT EXECUTE ON FUNCTION public.prodx_supervisor_find_credential(uuid, uuid, text) TO prodx_app'));
});

test('new privileged functions explicitly revoke PUBLIC and Supabase API-role execution', () => {
  assert.match(migration, /ARRAY\['anon', 'authenticated', 'service_role', 'prodx_app'\]/);
  assert.match(migration, /REVOKE ALL ON FUNCTION %s FROM PUBLIC/);
  assert.equal(migration.includes('GRANT EXECUTE ON FUNCTION public.prodx_auth_find_supervisor_credential'), false);
  for (const signature of [
    'prodx_seed_discount_policy_for_store()',
    'prodx_auth_find_supervisor_by_supabase_subject(uuid, uuid, uuid)',
    'prodx_auth_find_supervisor_credential(uuid, uuid, text)',
    'prodx_record_security_audit_event(uuid, uuid, uuid, text, jsonb)',
    'prodx_supervisor_reset_failed_attempts(uuid, uuid, uuid, text)',
  ]) {
    assert.ok(migration.includes(signature), `missing ACL hardening for ${signature}`);
  }
});

test('security audit RPC locks requester/actor/permission rows and enforces storeId on rejection', () => {
  assert.match(migration, /FOR SHARE OF requester, membership;/);
  assert.match(migration, /FOR SHARE OF actor, membership;/);
  assert.match(migration, /FOR SHARE OF actor, m, ur, r, rp, permission;/);
  assert.match(migration, /security audit store is required for supervisor rejection/);
  assert.match(migration, /security audit store does not match authenticated store/);
});

test('migration runner preserves prodx_app EXECUTE revocation for prodx_auth_find_supervisor_credential', () => {
  const migrateScript = readFileSync(new URL('../../scripts/migrate.ts', import.meta.url), 'utf8');
  assert.match(
    migrateScript,
    /to_regprocedure\('public\.prodx_auth_find_supervisor_credential\(uuid, uuid, text\)'\)/,
  );
});

