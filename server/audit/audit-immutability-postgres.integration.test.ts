import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresPool, resolveConfiguredDatabaseUrl } from '../db/postgres';

const url = resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);
const pool = url ? createPostgresPool({ connectionString: url, max: 4 }) : null;

const id = {
  org: '00000000-0000-4000-8000-000000003001',
  store: '00000000-0000-4000-8000-000000003002',
  user: '00000000-0000-4000-8000-000000003003',
  register: '00000000-0000-4000-8000-000000003004',
  audit: '00000000-0000-4000-8000-000000003005',
};

async function clean() {
  if (!pool) return;
  await pool.query('ALTER TABLE prodx_audit_log DISABLE TRIGGER prodx_audit_log_immutable_guard');
  try {
    await pool.query('DELETE FROM prodx_audit_log WHERE id=$1', [id.audit]);
    await pool.query('DELETE FROM prodx_registers WHERE id=$1', [id.register]);
    await pool.query('DELETE FROM prodx_store_memberships WHERE store_id=$1', [id.store]);
    await pool.query('DELETE FROM prodx_users WHERE id=$1', [id.user]);
    await pool.query('DELETE FROM prodx_stores WHERE id=$1', [id.store]);
    await pool.query('DELETE FROM prodx_organizations WHERE id=$1', [id.org]);
  } finally {
    await pool.query('ALTER TABLE prodx_audit_log ENABLE TRIGGER prodx_audit_log_immutable_guard');
  }
}

test('PostgreSQL audit log rejects UPDATE and DELETE while allowing append', async (t) => {
  if (!pool) { t.skip('DATABASE_URL not configured'); return; }
  await clean();
  t.after(async () => { await clean(); await pool.end(); });

  await pool.query('INSERT INTO prodx_organizations(id,code,name) VALUES($1,$2,$3)', [id.org, 'audit-immutable', 'Audit Immutable']);
  await pool.query("INSERT INTO prodx_stores(id,organization_id,code,name,business_timezone) VALUES($1,$2,'audit-1','Audit Store','Asia/Bangkok')", [id.store, id.org]);
  await pool.query('INSERT INTO prodx_users(id,organization_id,username,display_name) VALUES($1,$2,$3,$4)', [id.user, id.org, 'audit-user', 'Audit User']);
  await pool.query('INSERT INTO prodx_store_memberships(organization_id,store_id,user_id) VALUES($1,$2,$3)', [id.org, id.store, id.user]);
  await pool.query('INSERT INTO prodx_registers(id,organization_id,store_id,code,name) VALUES($1,$2,$3,$4,$5)', [id.register, id.org, id.store, 'AUDIT-1', 'Audit Register']);

  await pool.query(
    'INSERT INTO prodx_audit_log(id,organization_id,store_id,register_id,user_id,action,severity,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
    [id.audit, id.org, id.store, id.register, id.user, 'audit_immutability_test', 'info', JSON.stringify({ source: 'integration-test' })],
  );

  await assert.rejects(
    pool.query("UPDATE prodx_audit_log SET details='{}'::jsonb WHERE id=$1", [id.audit]),
    /append-only/i,
  );
  await assert.rejects(
    pool.query('DELETE FROM prodx_audit_log WHERE id=$1', [id.audit]),
    /append-only/i,
  );

  const row = (await pool.query('SELECT action, severity, details FROM prodx_audit_log WHERE id=$1', [id.audit])).rows[0];
  assert.equal(row.action, 'audit_immutability_test');
  assert.equal(row.severity, 'info');
  assert.deepEqual(row.details, { source: 'integration-test' });
});
