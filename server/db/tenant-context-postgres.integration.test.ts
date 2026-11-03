import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { createTransactionalPostgresExecutor } from './transaction.ts';
import { runWithRequestContext } from '../http/request-context-storage.ts';

const databaseUrl = process.env.DATABASE_URL;
const shouldRun = Boolean(databaseUrl) && process.env.NODE_ENV !== 'production';

test('transaction-local tenant context is isolated and cleared on pooled connection reuse', { skip: !shouldRun }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const executor = createTransactionalPostgresExecutor(pool);
  const first = {
    requestId: 'tenant-context-integration-a',
    principal: { userId: '00000000-0000-4000-8000-000000000001', organizationId: '00000000-0000-4000-8000-000000000011', storeId: '00000000-0000-4000-8000-000000000021' },
  };
  const second = {
    requestId: 'tenant-context-integration-b',
    principal: { userId: '00000000-0000-4000-8000-000000000002', organizationId: '00000000-0000-4000-8000-000000000012', storeId: '00000000-0000-4000-8000-000000000022' },
  };

  try {
    await runWithRequestContext(first, () => executor.transaction(async (tx) => {
      const result = await tx.query<{ organization_id: string; store_id: string; user_id: string }>(
        `SELECT current_setting('app.organization_id', true) AS organization_id,
                current_setting('app.store_id', true) AS store_id,
                current_setting('app.user_id', true) AS user_id`,
      );
      assert.deepEqual(result.rows[0], {
        organization_id: first.principal.organizationId,
        store_id: first.principal.storeId,
        user_id: first.principal.userId,
      });
    }));

    await runWithRequestContext(second, () => executor.transaction(async (tx) => {
      const result = await tx.query<{ organization_id: string; store_id: string; user_id: string }>(
        `SELECT current_setting('app.organization_id', true) AS organization_id,
                current_setting('app.store_id', true) AS store_id,
                current_setting('app.user_id', true) AS user_id`,
      );
      assert.deepEqual(result.rows[0], {
        organization_id: second.principal.organizationId,
        store_id: second.principal.storeId,
        user_id: second.principal.userId,
      });
    }));

    await assert.rejects(
      runWithRequestContext(first, () => executor.transaction(async (tx) => {
        const result = await tx.query<{ organization_id: string }>(
          `SELECT current_setting('app.organization_id', true) AS organization_id`,
        );
        assert.equal(result.rows[0]?.organization_id, first.principal.organizationId);
        throw new Error('intentional rollback context probe');
      })),
      /intentional rollback context probe/,
    );

    // max:1 forces the next query to reuse the released client. A local setting
    // from either prior transaction must not remain active on that connection.
    const afterRelease = await pool.query<{ organization_id: string | null; store_id: string | null; user_id: string | null }>(
      `SELECT current_setting('app.organization_id', true) AS organization_id,
              current_setting('app.store_id', true) AS store_id,
              current_setting('app.user_id', true) AS user_id`,
    );
    assert.notEqual(afterRelease.rows[0]?.organization_id, first.principal.organizationId);
    assert.notEqual(afterRelease.rows[0]?.organization_id, second.principal.organizationId);
    assert.notEqual(afterRelease.rows[0]?.store_id, first.principal.storeId);
    assert.notEqual(afterRelease.rows[0]?.store_id, second.principal.storeId);
    assert.notEqual(afterRelease.rows[0]?.user_id, first.principal.userId);
    assert.notEqual(afterRelease.rows[0]?.user_id, second.principal.userId);
  } finally {
    await pool.end();
  }
});


test('runtime role enforces fail-closed tenant/store RLS for SELECT, INSERT, UPDATE, and DELETE', { skip: !shouldRun }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const ids = {
    organizationA: randomUUID(),
    organizationB: randomUUID(),
    storeA: randomUUID(),
    storeA2: randomUUID(),
    storeB: randomUUID(),
    categoryA: randomUUID(),
    categoryA2: randomUUID(),
    categoryB: randomUUID(),
    categoryNew: randomUUID(),
    userA: randomUUID(),
    userB: randomUUID(),
    deviceA: randomUUID(),
    deviceB: randomUUID(),
    sessionA: randomUUID(),
    sessionB: randomUUID(),
  };
  const storeIds = [ids.storeA, ids.storeA2, ids.storeB];
  const categoryIds = [ids.categoryA, ids.categoryA2, ids.categoryB, ids.categoryNew];
  const userIds = [ids.userA, ids.userB];
  const deviceIds = [ids.deviceA, ids.deviceB];
  const sessionIds = [ids.sessionA, ids.sessionB];
  const client = await pool.connect();
  let roleSet = false;
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query(
      `INSERT INTO public.prodx_organizations (id, code, name) VALUES
        ($1, 'rls-it-a', 'RLS Integration A'), ($2, 'rls-it-b', 'RLS Integration B')`,
      [ids.organizationA, ids.organizationB],
    );
    await client.query(
      `INSERT INTO public.prodx_stores (id, organization_id, code, name, business_timezone) VALUES
        ($1, $4, 'rls-store-a', 'RLS Store A', 'Asia/Bangkok'),
        ($2, $4, 'rls-store-a2', 'RLS Store A2', 'Asia/Bangkok'),
        ($3, $5, 'rls-store-b', 'RLS Store B', 'Asia/Bangkok')`,
      [ids.storeA, ids.storeA2, ids.storeB, ids.organizationA, ids.organizationB],
    );
    await client.query(
      `INSERT INTO public.prodx_categories (id, organization_id, store_id, name, slug) VALUES
        ($1, $4, $5, 'RLS Category A', 'rls-category-a'),
        ($2, $4, $6, 'RLS Category A2', 'rls-category-a2'),
        ($3, $7, $8, 'RLS Category B', 'rls-category-b')`,
      [ids.categoryA, ids.categoryA2, ids.categoryB, ids.organizationA, ids.storeA, ids.storeA2, ids.organizationB, ids.storeB],
    );

    await client.query(
      `INSERT INTO public.prodx_users (id, organization_id, username, display_name, status) VALUES
        ($1, $3, 'rls-user-a', 'RLS User A', 'active'),
        ($2, $3, 'rls-user-b', 'RLS User B', 'active')`,
      [ids.userA, ids.userB, ids.organizationA],
    );
    await client.query(
      `INSERT INTO public.prodx_devices (id, organization_id, store_id, device_key, name, status) VALUES
        ($1, $3, $4, 'rls-device-a', 'RLS Device A', 'active'),
        ($2, $3, $4, 'rls-device-b', 'RLS Device B', 'active')`,
      [ids.deviceA, ids.deviceB, ids.organizationA, ids.storeA],
    );
    await client.query(
      `INSERT INTO public.prodx_sessions (id, organization_id, user_id, device_id, token_hash, expires_at) VALUES
        ($1, $3, $4, $6, 'rls-session-token-a', CURRENT_TIMESTAMP + INTERVAL '1 hour'),
        ($2, $3, $5, $7, 'rls-session-token-b', CURRENT_TIMESTAMP + INTERVAL '1 hour')`,
      [ids.sessionA, ids.sessionB, ids.organizationA, ids.userA, ids.userB, ids.deviceA, ids.deviceB],
    );

    const role = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
      ['prodx_app'],
    );
    assert.equal(role.rows.length, 1);
    assert.equal(role.rows[0].rolsuper, false);
    assert.equal(role.rows[0].rolbypassrls, false);

    const tenantTables = ['prodx_categories', 'prodx_products', 'prodx_orders', 'prodx_inventory_ledger', 'prodx_cash_movements'];
    const policies = await pool.query<{ tablename: string; qual: string | null; with_check: string | null }>(
      `SELECT tablename, qual, with_check FROM pg_policies
        WHERE schemaname = 'public'
          AND 'prodx_app'::name = ANY(roles)
          AND tablename = ANY($1::text[])`,
      [tenantTables],
    );
    assert.equal(policies.rows.length, tenantTables.length);
    for (const policy of policies.rows) {
      assert.notEqual(policy.qual?.trim().toLowerCase(), 'true', `${policy.tablename} must not allow every row`);
      assert.notEqual(policy.with_check?.trim().toLowerCase(), 'true', `${policy.tablename} must not allow every inserted/updated row`);
    }

    const globalPermissionDml = await pool.query<{ can_insert: boolean; can_update: boolean; can_delete: boolean }>(
      `SELECT has_table_privilege('prodx_app', 'public.prodx_permissions', 'INSERT') AS can_insert,
              has_table_privilege('prodx_app', 'public.prodx_permissions', 'UPDATE') AS can_update,
              has_table_privilege('prodx_app', 'public.prodx_permissions', 'DELETE') AS can_delete`,
    );
    assert.deepEqual(globalPermissionDml.rows[0], { can_insert: false, can_update: false, can_delete: false });

    const permissionPolicy = await pool.query<{ cmd: string; qual: string | null }>(
      `SELECT cmd, qual FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'prodx_permissions'
          AND policyname = 'prodx_app_global_permissions_read'
          AND 'prodx_app'::name = ANY(roles)`,
    );
    assert.equal(permissionPolicy.rows.length, 1, 'global permission catalog must have one runtime read policy');
    assert.equal(permissionPolicy.rows[0].cmd, 'SELECT');
    assert.match(permissionPolicy.rows[0].qual ?? '', /permission_key IS NOT NULL/i);
    assert.match(permissionPolicy.rows[0].qual ?? '', /length\(btrim\(permission_key\)\) > 0/i);

    const unboundedPolicies = await pool.query<{ tablename: string; policyname: string; qual: string | null; with_check: string | null }>(
      `SELECT tablename, policyname, qual, with_check
         FROM pg_policies
        WHERE schemaname = 'public'
          AND ('prodx_app'::name = ANY(roles) OR 'public'::name = ANY(roles))
          AND (
            lower(regexp_replace(coalesce(qual, ''), '[[:space:]()]', '', 'g')) = 'true'
            OR lower(regexp_replace(coalesce(with_check, ''), '[[:space:]()]', '', 'g')) = 'true'
          )`,
    );
    assert.deepEqual(unboundedPolicies.rows, [], 'tenant/internal RLS policies must not grant unconditional access');

    await client.query('SET ROLE prodx_app');
    roleSet = true;
    await client.query(
      `SELECT set_config('app.organization_id', $1, true),
              set_config('app.store_id', $2, true),
              set_config('app.user_id', $3, true)`,
      [ids.organizationA, ids.storeA, ids.userA],
    );

    const visiblePermissions = await client.query<{ permission_key: string }>(
      `SELECT permission_key FROM public.prodx_permissions WHERE permission_key = 'dashboard.read'`,
    );
    assert.deepEqual(visiblePermissions.rows.map((row) => row.permission_key), ['dashboard.read']);

    const visible = await client.query<{ id: string }>('SELECT id FROM public.prodx_categories ORDER BY id');
    assert.deepEqual(visible.rows.map((row) => row.id), [ids.categoryA]);
    assert.equal(
      (await client.query('SELECT id FROM public.prodx_categories WHERE id = $1', [ids.categoryA2])).rowCount,
      0,
      'same-organization cross-store SELECT must be denied',
    );
    assert.equal(
      (await client.query('SELECT id FROM public.prodx_categories WHERE id = $1', [ids.categoryB])).rowCount,
      0,
      'cross-organization SELECT must be denied',
    );

    const visibleSessions = await client.query<{ id: string }>('SELECT id FROM public.prodx_sessions ORDER BY id');
    assert.deepEqual(visibleSessions.rows.map((row) => row.id), [ids.sessionA]);
    const otherUserSession = await client.query<{ id: string }>(
      'SELECT id FROM public.prodx_sessions WHERE id = $1',
      [ids.sessionB],
    );
    assert.equal(otherUserSession.rowCount, 0, 'same-store sessions belonging to another user must not be visible');

    const crossStoreUpdate = await client.query(
      'UPDATE public.prodx_categories SET name = $1 WHERE id = $2',
      ['must not update', ids.categoryA2],
    );
    assert.equal(crossStoreUpdate.rowCount, 0);
    const crossOrganizationUpdate = await client.query(
      'UPDATE public.prodx_categories SET name = $1 WHERE id = $2',
      ['must not update cross organization', ids.categoryB],
    );
    assert.equal(crossOrganizationUpdate.rowCount, 0);
    const crossStoreDelete = await client.query(
      'DELETE FROM public.prodx_categories WHERE id = $1',
      [ids.categoryA2],
    );
    assert.equal(crossStoreDelete.rowCount, 0);
    const crossOrganizationDelete = await client.query(
      'DELETE FROM public.prodx_categories WHERE id = $1',
      [ids.categoryB],
    );
    assert.equal(crossOrganizationDelete.rowCount, 0);

    await client.query('SAVEPOINT deny_cross_store_insert');
    await assert.rejects(
      client.query(
        'INSERT INTO public.prodx_categories (id, organization_id, store_id, name, slug) VALUES ($1, $2, $3, $4, $5)',
        [ids.categoryNew, ids.organizationA, ids.storeA2, 'Forbidden A2', 'forbidden-a2'],
      ),
      (error: unknown) => (error as { code?: string }).code === '42501',
    );
    await client.query('ROLLBACK TO SAVEPOINT deny_cross_store_insert');

    await client.query('SAVEPOINT deny_cross_org_insert');
    await assert.rejects(
      client.query(
        'INSERT INTO public.prodx_categories (id, organization_id, store_id, name, slug) VALUES ($1, $2, $3, $4, $5)',
        [ids.categoryNew, ids.organizationB, ids.storeB, 'Forbidden B', 'forbidden-b'],
      ),
      (error: unknown) => (error as { code?: string }).code === '42501',
    );
    await client.query('ROLLBACK TO SAVEPOINT deny_cross_org_insert');

    await client.query(
      'INSERT INTO public.prodx_categories (id, organization_id, store_id, name, slug) VALUES ($1, $2, $3, $4, $5)',
      [ids.categoryNew, ids.organizationA, ids.storeA, 'Allowed A', 'allowed-a'],
    );
    const allowedUpdate = await client.query(
      'UPDATE public.prodx_categories SET name = $1 WHERE id = $2',
      ['Allowed A Updated', ids.categoryNew],
    );
    assert.equal(allowedUpdate.rowCount, 1);
    const allowedDelete = await client.query('DELETE FROM public.prodx_categories WHERE id = $1', [ids.categoryNew]);
    assert.equal(allowedDelete.rowCount, 1);

    await client.query('SAVEPOINT deny_direct_credentials');
    await assert.rejects(
      client.query('SELECT user_id FROM public.prodx_user_credentials LIMIT 1'),
      (error: unknown) => (error as { code?: string }).code === '42501',
    );
    await client.query('ROLLBACK TO SAVEPOINT deny_direct_credentials');

    await client.query('SAVEPOINT deny_direct_throttle');
    await assert.rejects(
      client.query('SELECT client_fingerprint FROM public.prodx_auth_login_throttles LIMIT 1'),
      (error: unknown) => (error as { code?: string }).code === '42501',
    );
    await client.query('ROLLBACK TO SAVEPOINT deny_direct_throttle');

    // Roll back setup and audit-trigger effects so immutable audit rows and FK references never leak between test runs.
    await client.query('ROLLBACK');
    transactionStarted = false;
  } finally {
    if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined);
    if (roleSet) await client.query('RESET ROLE').catch(() => undefined);
    client.release();
    await pool.end();
  }
});
