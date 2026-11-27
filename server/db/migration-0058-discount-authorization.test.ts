import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const migration = readFileSync(join(process.cwd(), 'db/migrations/0058_m10_server_discount_authorization.sql'), 'utf8');

test('0058 provisions tenant/store-owned discount policy with safe defaults and constraints', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS prodx_discount_policies/i);
  assert.match(migration, /require_supervisor_approval BOOLEAN NOT NULL DEFAULT TRUE/i);
  assert.match(migration, /max_discount_without_approval_bps INTEGER NOT NULL DEFAULT 1500/i);
  assert.match(migration, /CHECK \(max_discount_without_approval_bps BETWEEN 0 AND 10000\)/i);
  assert.match(migration, /FOREIGN KEY \(store_id, organization_id\) REFERENCES prodx_stores\(id, organization_id\)/i);
  assert.match(migration, /INSERT INTO prodx_discount_policies \(organization_id, store_id\)/i);
  assert.match(migration, /CREATE TRIGGER prodx_stores_seed_discount_policy/i);
});

test('0058 binds discount grants to checkout identity and policy while preserving refund/void order FK', () => {
  assert.match(migration, /ALTER COLUMN order_id DROP NOT NULL/i);
  assert.match(migration, /action_key IN \('refund', 'void', 'discount'\)/i);
  assert.match(migration, /checkout_idempotency_key IS NOT NULL/i);
  assert.match(migration, /checkout_payload_hash IS NOT NULL AND checkout_payload_hash ~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(migration, /policy_threshold_bps IS NOT NULL AND policy_threshold_bps BETWEEN 0 AND 10000/i);
  assert.match(migration, /policy_requires_approval IS TRUE/i);
  assert.match(migration, /Keep the existing composite order\/store FK/i);
  assert.doesNotMatch(migration, /DROP CONSTRAINT IF EXISTS prodx_supervisor_authorizations_order_store_fk/i);
});

test('0058 exposes narrow tenant-scoped credential and append-only audit functions', () => {
  assert.match(migration, /FUNCTION public\.prodx_auth_find_supervisor_by_supabase_subject/i);
  assert.match(migration, /u\.supabase_auth_user_id = p_supabase_subject/i);
  assert.match(migration, /FUNCTION public\.prodx_auth_find_supervisor_credential/i);
  assert.match(migration, /c\.credential_type = 'password'/i);
  assert.match(migration, /SECURITY DEFINER/i);
  assert.match(migration, /p_organization_id = NULLIF\(current_setting\('app\.organization_id'/i);
  assert.match(migration, /p_store_id = NULLIF\(current_setting\('app\.store_id'/i);
  assert.match(migration, /m\.active = TRUE/i);
  assert.match(migration, /FUNCTION public\.prodx_record_security_audit_event/i);
  assert.match(migration, /p_organization_id IS DISTINCT FROM NULLIF\(current_setting\('app\.organization_id'/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.prodx_record_security_audit_event/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.prodx_record_security_audit_event.*TO prodx_app/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.prodx_auth_find_supervisor_by_supabase_subject.*TO prodx_app/i);
});

test('0058 enforces RLS and separates discount request from supervisor approval permission', () => {
  assert.match(migration, /ALTER TABLE prodx_discount_policies ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /ALTER TABLE prodx_discount_policies FORCE ROW LEVEL SECURITY/i);
  assert.match(migration, /CREATE POLICY prodx_app_tenant_isolation ON prodx_discount_policies/i);
  assert.match(migration, /store_id = NULLIF\(current_setting\('app\.store_id'/i);
  assert.match(migration, /'pos\.discount\.approve'/i);
  assert.match(migration, /r\.role_key IN \('owner', 'admin', 'manager'\)/i);
  assert.match(migration, /r\.role_key = 'cashier'/i);
  assert.match(migration, /VALUES \('0058_m10_server_discount_authorization'\)/i);
});
