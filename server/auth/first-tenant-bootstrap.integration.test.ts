import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresPool, resolveConfiguredDatabaseUrl } from '../db/postgres';
import { createPostgresFirstTenantBootstrapRepository, type FirstTenantBootstrapInput } from './postgres-repository';

const databaseUrl = process.env.PRODX_RUN_BOOTSTRAP_POSTGRES_INTEGRATION === '1'
  ? resolveConfiguredDatabaseUrl(process.env.PRODX_BOOTSTRAP_TEST_DATABASE_URL)
  : null;
const pool = databaseUrl ? createPostgresPool({ connectionString: databaseUrl, max: 4 }) : null;
const repository = pool ? createPostgresFirstTenantBootstrapRepository({
  async query<T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) {
    const result = await pool!.query(sql, [...parameters]);
    return result.rows as T[];
  },
}) : null;

const makeInput = (subject: string, suffix: string): FirstTenantBootstrapInput => ({
  supabaseUserId: subject,
  organizationCode: `bootstrap-${suffix}`,
  organizationName: `Bootstrap Organization ${suffix}`,
  storeCode: `store-${suffix}`,
  storeName: `Bootstrap Store ${suffix}`,
  businessTimezone: 'Asia/Bangkok',
  ownerUsername: `owner-${suffix}@example.invalid`,
  ownerDisplayName: `Bootstrap Owner ${suffix}`,
  deviceKey: `ADMIN-CONSOLE-${suffix}`,
  deviceName: `Bootstrap Admin Device ${suffix}`,
});

const cleanup = async (): Promise<void> => {
  if (!pool) return;
  await pool.query(`DELETE FROM public.prodx_security_audit_events WHERE event_type = 'first_tenant_bootstrapped'`);
  await pool.query(`DELETE FROM public.prodx_sessions WHERE organization_id IN (SELECT id FROM public.prodx_organizations WHERE code LIKE 'bootstrap-%')`);
  await pool.query(`DELETE FROM public.prodx_user_roles WHERE organization_id IN (SELECT id FROM public.prodx_organizations WHERE code LIKE 'bootstrap-%')`);
  await pool.query(`DELETE FROM public.prodx_role_permissions WHERE organization_id IN (SELECT id FROM public.prodx_organizations WHERE code LIKE 'bootstrap-%')`);
  await pool.query(`DELETE FROM public.prodx_store_memberships WHERE organization_id IN (SELECT id FROM public.prodx_organizations WHERE code LIKE 'bootstrap-%')`);
  await pool.query(`DELETE FROM public.prodx_devices WHERE organization_id IN (SELECT id FROM public.prodx_organizations WHERE code LIKE 'bootstrap-%')`);
  await pool.query(`DELETE FROM public.prodx_users WHERE organization_id IN (SELECT id FROM public.prodx_organizations WHERE code LIKE 'bootstrap-%')`);
  await pool.query(`DELETE FROM public.prodx_roles WHERE organization_id IN (SELECT id FROM public.prodx_organizations WHERE code LIKE 'bootstrap-%')`);
  await pool.query(`DELETE FROM public.prodx_stores WHERE organization_id IN (SELECT id FROM public.prodx_organizations WHERE code LIKE 'bootstrap-%')`);
  await pool.query(`DELETE FROM public.prodx_organizations WHERE code LIKE 'bootstrap-%'`);
};

test('first-tenant PostgreSQL bootstrap is atomic, concurrent-safe, idempotent, and tenant-scoped', async (t) => {
  if (!pool || !repository) {
    t.skip('PRODX_BOOTSTRAP_TEST_DATABASE_URL is not configured; run the isolated bootstrap PostgreSQL gate.');
    return;
  }
  t.after(async () => {
    await cleanup();
    await pool.end();
  });

  await cleanup();
  const initial = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM public.prodx_organizations');
  assert.equal(initial.rows[0].count, '0', 'the dedicated bootstrap database must start without tenant rows');

  const failedAuditInput = makeInput('00000000-0000-4000-8000-000000000051', 'rollback');
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.prodx_test_reject_bootstrap_audit()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.event_type = 'first_tenant_bootstrapped' THEN
        RAISE EXCEPTION 'forced bootstrap audit failure';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER prodx_test_reject_bootstrap_audit
      BEFORE INSERT ON public.prodx_security_audit_events
      FOR EACH ROW EXECUTE FUNCTION public.prodx_test_reject_bootstrap_audit();
  `);
  await assert.rejects(repository.bootstrapFirstTenant(failedAuditInput), /forced bootstrap audit failure/);
  await pool.query('DROP TRIGGER prodx_test_reject_bootstrap_audit ON public.prodx_security_audit_events');
  await pool.query('DROP FUNCTION public.prodx_test_reject_bootstrap_audit()');
  const rolledBack = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM public.prodx_organizations');
  assert.equal(rolledBack.rows[0].count, '0', 'failed audit insertion must roll back every provisioned row');

  const inputs = [
    makeInput('00000000-0000-4000-8000-000000000061', 'race-a'),
    makeInput('00000000-0000-4000-8000-000000000062', 'race-b'),
  ];
  const outcomes = await Promise.allSettled(inputs.map((input) => repository.bootstrapFirstTenant(input)));
  const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
  const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent subject may claim the first tenant');
  assert.equal(rejected.length, 1, 'the losing concurrent subject must fail closed');
  const winnerIndex = outcomes.findIndex((outcome) => outcome.status === 'fulfilled');
  const winningInput = inputs[winnerIndex];
  const winningOutcome = outcomes[winnerIndex];
  assert.equal(winningOutcome.status, 'fulfilled');
  if (winningOutcome.status !== 'fulfilled') throw new Error('Expected one successful bootstrap outcome.');
  const winner = winningOutcome.value;
  assert.ok(winner);

  const retry = await repository.bootstrapFirstTenant(winningInput);
  assert.deepEqual(retry, winner, 'an exact retry must return the same provisioned IDs');

  const loserIndex = 1 - winnerIndex;
  await assert.rejects(repository.bootstrapFirstTenant(inputs[loserIndex]));

  const persisted = await pool.query<{
    organizations: string; stores: string; users: string; roles: string; memberships: string;
    assignments: string; devices: string; audit_events: string; credentials: string;
    permissions: string; assigned_permissions: string; role_key: string; subject_id: string;
  }>(`
    SELECT
      (SELECT count(*) FROM public.prodx_organizations)::text AS organizations,
      (SELECT count(*) FROM public.prodx_stores)::text AS stores,
      (SELECT count(*) FROM public.prodx_users)::text AS users,
      (SELECT count(*) FROM public.prodx_roles)::text AS roles,
      (SELECT count(*) FROM public.prodx_store_memberships)::text AS memberships,
      (SELECT count(*) FROM public.prodx_user_roles)::text AS assignments,
      (SELECT count(*) FROM public.prodx_devices)::text AS devices,
      (SELECT count(*) FROM public.prodx_security_audit_events WHERE event_type = 'first_tenant_bootstrapped')::text AS audit_events,
      (SELECT count(*) FROM public.prodx_user_credentials WHERE user_id = $1)::text AS credentials,
      (SELECT count(*) FROM public.prodx_permissions)::text AS permissions,
      (SELECT count(*) FROM public.prodx_role_permissions WHERE organization_id = $2 AND role_id = $3)::text AS assigned_permissions,
      (SELECT role_key FROM public.prodx_roles WHERE id = $3) AS role_key,
      (SELECT supabase_auth_user_id::text FROM public.prodx_users WHERE id = $1) AS subject_id
  `, [winner.userId, winner.organizationId, winner.roleId]);

  assert.deepEqual(persisted.rows[0], {
    organizations: '1',
    stores: '1',
    users: '1',
    roles: '1',
    memberships: '1',
    assignments: '1',
    devices: '1',
    audit_events: '1',
    credentials: '0',
    permissions: persisted.rows[0].permissions,
    assigned_permissions: persisted.rows[0].permissions,
    role_key: 'owner',
    subject_id: winningInput.supabaseUserId,
  });
  assert.ok(Number(persisted.rows[0].permissions) >= 1);
});
