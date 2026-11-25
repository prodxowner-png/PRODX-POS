import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { createPostgresPool } from '../db/postgres';
import { resolveDisposableTestDatabaseUrl } from '../db/test-database-guard';
import { hashPassword } from './password';
import type { SqlExecutor } from './postgres-repository';
import { createSupervisorAuthorizationService, SupervisorAuthorizationError } from './supervisor-authorization';

const databaseUrl = resolveDisposableTestDatabaseUrl(process.env.DATABASE_URL, 'server/auth/supervisor-authorization-prodx-app.integration.test.ts');
const pool = databaseUrl ? createPostgresPool({ connectionString: databaseUrl, max: 2 }) : null;

const SECRET = 'Supervisor-Step-Up-Secret!47';

const executorFor = (client: PoolClient): SqlExecutor => ({
  async query<T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) {
    return (await client.query(sql, [...parameters])).rows as T[];
  },
});

const isAuthError = (code: SupervisorAuthorizationError['code']) => (error: unknown) =>
  error instanceof SupervisorAuthorizationError && error.code === code;

/**
 * Runs `work` exactly as production does: inside a transaction, as the
 * least-privileged prodx_app role (NOSUPERUSER, NOBYPASSRLS), with the
 * transaction-local tenant context that createTransactionalPostgresExecutor sets.
 */
const asRuntimeRole = async <T>(
  client: PoolClient,
  context: { organizationId: string; storeId: string; userId: string },
  savepoint: string,
  work: () => Promise<T>,
): Promise<T> => {
  await client.query(`SAVEPOINT ${savepoint}`);
  await client.query('SET LOCAL ROLE prodx_app');
  await client.query(
    `SELECT set_config('app.organization_id', $1, true),
            set_config('app.store_id', $2, true),
            set_config('app.user_id', $3, true)`,
    [context.organizationId, context.storeId, context.userId],
  );
  try {
    const result = await work();
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    // Mirrors the route: a rejected authorization commits its failed-attempt
    // counter and audit evidence; any unexpected error rolls everything back.
    await client.query(error instanceof SupervisorAuthorizationError
      ? `RELEASE SAVEPOINT ${savepoint}`
      : `ROLLBACK TO SAVEPOINT ${savepoint}`);
    throw error;
  } finally {
    await client.query('RESET ROLE');
  }
};

test('supervisor authorization works end-to-end under the real prodx_app runtime role without direct credential access', async (t) => {
  if (!pool) {
    t.skip('DATABASE_URL is not configured; run with PostgreSQL migrations applied.');
    return;
  }

  const client = await pool.connect();
  t.after(async () => {
    client.release();
    await pool.end();
  });

  const ids = {
    org: randomUUID(), otherOrg: randomUUID(), store: randomUUID(), otherStore: randomUUID(),
    register: randomUUID(), device: randomUUID(), shift: randomUUID(), order: randomUUID(),
    requester: randomUUID(), session: randomUUID(), supervisor: randomUUID(), cashier: randomUUID(),
    otherSupervisor: randomUUID(), nonMemberSupervisor: randomUUID(), supervisorRole: randomUUID(), cashierRole: randomUUID(),
    otherRole: randomUUID(),
  };
  const suffix = ids.org.replaceAll('-', '').slice(0, 12);
  const secretHash = await hashPassword(SECRET);

  await client.query('BEGIN');
  try {
    // API roles must never execute these SECURITY DEFINER functions directly.
    // The server runtime retains only the three narrow, tenant-scoped RPCs.
    const functionPrivileges = await client.query<{
      signature: string;
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
      prodx_app: boolean;
    }>(`WITH expected(signature, app_expected) AS (VALUES
        ('public.prodx_seed_discount_policy_for_store()'::regprocedure, FALSE),
        ('public.prodx_auth_find_supervisor_by_supabase_subject(uuid,uuid,uuid)'::regprocedure, TRUE),
        ('public.prodx_auth_find_supervisor_credential(uuid,uuid,text)'::regprocedure, TRUE),
        ('public.prodx_record_security_audit_event(uuid,uuid,uuid,text,jsonb)'::regprocedure, TRUE)
      )
      SELECT signature::text,
             CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
               THEN has_function_privilege('anon', signature, 'EXECUTE') ELSE FALSE END AS anon,
             CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
               THEN has_function_privilege('authenticated', signature, 'EXECUTE') ELSE FALSE END AS authenticated,
             CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
               THEN has_function_privilege('service_role', signature, 'EXECUTE') ELSE FALSE END AS service_role,
             has_function_privilege('prodx_app', signature, 'EXECUTE') AS prodx_app
        FROM expected ORDER BY signature::text`);
    assert.deepEqual(functionPrivileges.rows, [
      { signature: 'prodx_auth_find_supervisor_by_supabase_subject(uuid,uuid,uuid)', anon: false, authenticated: false, service_role: false, prodx_app: true },
      { signature: 'prodx_auth_find_supervisor_credential(uuid,uuid,text)', anon: false, authenticated: false, service_role: false, prodx_app: true },
      { signature: 'prodx_record_security_audit_event(uuid,uuid,uuid,text,jsonb)', anon: false, authenticated: false, service_role: false, prodx_app: true },
      { signature: 'prodx_seed_discount_policy_for_store()', anon: false, authenticated: false, service_role: false, prodx_app: false },
    ]);

    // Fixtures are seeded by the migration owner, then every assertion below
    // executes as prodx_app with RLS and table grants fully in force.
    await client.query(`INSERT INTO public.prodx_organizations (id, code, name) VALUES ($1, $2, 'Supervisor RPC Org'), ($3, $4, 'Supervisor RPC Other Org')`,
      [ids.org, `sup-rpc-${suffix}`, ids.otherOrg, `sup-rpc-other-${suffix}`]);
    await client.query(`INSERT INTO public.prodx_stores (id, organization_id, code, name, business_timezone) VALUES ($1, $2, $3, 'Supervisor RPC Store', 'Asia/Bangkok'), ($4, $5, $6, 'Other Store', 'Asia/Bangkok')`,
      [ids.store, ids.org, `sup-store-${suffix}`, ids.otherStore, ids.otherOrg, `sup-other-store-${suffix}`]);
    await client.query(`INSERT INTO public.prodx_users (id, organization_id, username, display_name, status) VALUES
        ($1, $5, $6, 'Requester', 'active'),
        ($2, $5, $7, 'Supervisor', 'active'),
        ($3, $5, $8, 'Cashier Without Permission', 'active'),
        ($4, $9, $10, 'Other Tenant Supervisor', 'active'),
        ($11, $5, $12, 'Supervisor Without Store Membership', 'active')`,
      [ids.requester, ids.supervisor, ids.cashier, ids.otherSupervisor, ids.org,
        `sup-requester-${suffix}`, `sup-supervisor-${suffix}`, `sup-cashier-${suffix}`, ids.otherOrg, `sup-supervisor-${suffix}`,
        ids.nonMemberSupervisor, `sup-nonmember-${suffix}`]);
    await client.query(`INSERT INTO public.prodx_user_credentials (user_id, credential_type, secret_hash) VALUES ($1, 'password', $4), ($2, 'password', $4), ($3, 'password', $4), ($5, 'password', $4)`,
      [ids.supervisor, ids.cashier, ids.otherSupervisor, secretHash, ids.nonMemberSupervisor]);
    await client.query(`INSERT INTO public.prodx_roles (id, organization_id, role_key, name, active) VALUES ($1, $3, 'supervisor', 'Supervisor', TRUE), ($2, $3, 'cashier', 'Cashier', TRUE), ($4, $5, 'supervisor', 'Supervisor', TRUE)`,
      [ids.supervisorRole, ids.cashierRole, ids.org, ids.otherRole, ids.otherOrg]);
    for (const permissionKey of ['pos.refund', 'pos.void', 'pos.sell']) {
      await client.query(`INSERT INTO public.prodx_permissions (id, permission_key, description) VALUES ($1, $2, $2) ON CONFLICT (permission_key) DO NOTHING`, [randomUUID(), permissionKey]);
    }
    await client.query(`INSERT INTO public.prodx_role_permissions (organization_id, role_id, permission_id)
        SELECT $1::uuid, $2::uuid, id FROM public.prodx_permissions WHERE permission_key IN ('pos.refund', 'pos.void')
        UNION ALL
        SELECT $1::uuid, $3::uuid, id FROM public.prodx_permissions WHERE permission_key = 'pos.sell'
        UNION ALL
        SELECT $4::uuid, $5::uuid, id FROM public.prodx_permissions WHERE permission_key IN ('pos.refund', 'pos.void')`,
      [ids.org, ids.supervisorRole, ids.cashierRole, ids.otherOrg, ids.otherRole]);
    await client.query(`INSERT INTO public.prodx_store_memberships (organization_id, store_id, user_id, active) VALUES ($1, $2, $3, TRUE), ($1, $2, $4, TRUE), ($1, $2, $5, TRUE), ($6, $7, $8, TRUE)`,
      [ids.org, ids.store, ids.requester, ids.supervisor, ids.cashier, ids.otherOrg, ids.otherStore, ids.otherSupervisor]);
    await client.query(`INSERT INTO public.prodx_store_memberships (organization_id, store_id, user_id, active) VALUES ($1, $2, $3, FALSE)`,
      [ids.org, ids.store, ids.nonMemberSupervisor]);
    await client.query(`INSERT INTO public.prodx_user_roles (organization_id, store_id, user_id, role_id, active) VALUES ($1, $2, $3, $4, TRUE), ($1, $2, $5, $6, TRUE), ($1, $2, $7, $6, TRUE), ($8, $9, $10, $11, TRUE)`,
      [ids.org, ids.store, ids.supervisor, ids.supervisorRole, ids.cashier, ids.cashierRole, ids.requester, ids.otherOrg, ids.otherStore, ids.otherSupervisor, ids.otherRole]);
    await client.query(`INSERT INTO public.prodx_registers (id, organization_id, store_id, code, name) VALUES ($1, $2, $3, $4, 'Register')`,
      [ids.register, ids.org, ids.store, `SUP-REG-${suffix}`]);
    await client.query(`INSERT INTO public.prodx_devices (id, organization_id, store_id, device_key, name, status) VALUES ($1, $2, $3, $4, 'Device', 'active')`,
      [ids.device, ids.org, ids.store, `SUP-DEV-${suffix}`]);
    await client.query(`INSERT INTO public.prodx_sessions (id, organization_id, user_id, device_id, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP + INTERVAL '1 hour')`,
      [ids.session, ids.org, ids.requester, ids.device, `sup-rpc-session-${suffix}`]);
    await client.query(`INSERT INTO public.prodx_shifts (id, organization_id, store_id, register_id, cashier_id, opening_float_amount, currency) VALUES ($1, $2, $3, $4, $5, 0, 'THB')`,
      [ids.shift, ids.org, ids.store, ids.register, ids.requester]);
    await client.query(`INSERT INTO public.prodx_orders (id, organization_id, store_id, register_id, cashier_id, shift_id, order_number, idempotency_key,
          gross_subtotal_amount, net_subtotal_amount, grand_total_amount, total_items_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 10.00, 10.00, 10.00, 1)`,
      [ids.order, ids.org, ids.store, ids.register, ids.requester, ids.shift, `SUP-ORD-${suffix}`, `sup-rpc-order-${suffix}`]);

    const context = { organizationId: ids.org, storeId: ids.store, userId: ids.requester };
    const request = {
      organizationId: ids.org, storeId: ids.store, requesterUserId: ids.requester, requesterSessionId: ids.session,
      action: 'refund' as const, orderId: ids.order, supervisorUsername: `SUP-SUPERVISOR-${suffix}`,
    };
    const service = createSupervisorAuthorizationService(executorFor(client));

    // Regression guard for F-01: the runtime role must still be denied direct credential access.
    await assert.rejects(
      asRuntimeRole(client, context, 'direct_credential_read', () => client.query('SELECT secret_hash FROM public.prodx_user_credentials LIMIT 1')),
      (error: unknown) => (error as { code?: string }).code === '42501',
    );
    await assert.rejects(
      asRuntimeRole(client, context, 'direct_credential_update', () => client.query('UPDATE public.prodx_user_credentials SET failed_attempts = 0')),
      (error: unknown) => (error as { code?: string }).code === '42501',
    );
    const privileges = await client.query<{ find: boolean; fail: boolean; reset: boolean; anyone: boolean }>(`
      SELECT has_function_privilege('prodx_app', 'public.prodx_supervisor_find_credential(uuid,uuid,text)', 'EXECUTE') AS find,
             has_function_privilege('prodx_app', 'public.prodx_supervisor_record_failed_attempt(uuid,uuid,uuid)', 'EXECUTE') AS fail,
             has_function_privilege('prodx_app', 'public.prodx_supervisor_reset_failed_attempts(uuid,uuid,uuid,text)', 'EXECUTE') AS reset,
             EXISTS (
               SELECT 1 FROM pg_catalog.pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
                WHERE p.oid IN ('public.prodx_supervisor_find_credential(uuid,uuid,text)'::regprocedure,
                                'public.prodx_supervisor_record_failed_attempt(uuid,uuid,uuid)'::regprocedure,
                                'public.prodx_supervisor_reset_failed_attempts(uuid,uuid,uuid,text)'::regprocedure)
                  AND acl.grantee = 0
             ) AS anyone`);
    assert.deepEqual(privileges.rows[0], { find: true, fail: true, reset: true, anyone: false });
    const definers = await client.query<{ proname: string; prosecdef: boolean; proconfig: string[] }>(`
      SELECT proname, prosecdef, proconfig FROM pg_catalog.pg_proc
       WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'prodx_supervisor_%' ORDER BY proname`);
    assert.equal(definers.rows.length, 3);
    for (const row of definers.rows) {
      assert.equal(row.prosecdef, true, `${row.proname} must be SECURITY DEFINER`);
      assert.deepEqual(row.proconfig, ['search_path=pg_catalog'], `${row.proname} must pin search_path`);
    }

    // Wrong secret: counted atomically, audited, and persisted (not rolled back).
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await assert.rejects(
        asRuntimeRole(client, context, `wrong_secret_${attempt}`, () => service.authorize({ ...request, supervisorSecret: 'wrong-secret' })),
        isAuthError('INVALID_CREDENTIALS'),
      );
    }
    const afterFailures = await client.query<{ failed_attempts: number; locked: boolean }>(
      'SELECT failed_attempts, locked_until IS NOT NULL AS locked FROM public.prodx_user_credentials WHERE user_id = $1', [ids.supervisor]);
    assert.deepEqual(afterFailures.rows[0], { failed_attempts: 4, locked: false });

    // Correct secret clears the counter and issues a tenant-scoped one-time token.
    const granted = await asRuntimeRole(client, context, 'grant_token', () => service.authorize({ ...request, supervisorSecret: SECRET }));
    assert.equal(granted.supervisorUserId, ids.supervisor);
    assert.ok(granted.authorizationToken.length >= 40);
    const afterGrant = await client.query<{ failed_attempts: number; locked: boolean; authenticated: boolean }>(
      'SELECT failed_attempts, locked_until IS NOT NULL AS locked, last_authenticated_at IS NOT NULL AS authenticated FROM public.prodx_user_credentials WHERE user_id = $1', [ids.supervisor]);
    assert.deepEqual(afterGrant.rows[0], { failed_attempts: 0, locked: false, authenticated: true });

    const consumed = await asRuntimeRole(client, context, 'consume', () => service.consume({
      token: granted.authorizationToken, organizationId: ids.org, storeId: ids.store, requesterUserId: ids.requester,
      requesterSessionId: ids.session, action: 'refund', orderId: ids.order,
    }));
    assert.equal(consumed.supervisorUserId, ids.supervisor);
    await assert.rejects(
      asRuntimeRole(client, context, 'replay', () => service.consume({
        token: granted.authorizationToken, organizationId: ids.org, storeId: ids.store, requesterUserId: ids.requester,
        requesterSessionId: ids.session, action: 'refund', orderId: ids.order,
      })),
      isAuthError('AUTHORIZATION_REPLAYED'),
    );

    // Valid credential without store-scoped refund permission is denied, and
    // the permission-gated reset RPC refuses to clear that user's counter.
    await client.query('UPDATE public.prodx_user_credentials SET failed_attempts = 2 WHERE user_id = $1', [ids.cashier]);
    await assert.rejects(
      asRuntimeRole(client, context, 'cashier_denied', () => service.authorize({ ...request, supervisorUsername: undefined, supervisorUserId: ids.cashier, supervisorSecret: SECRET })),
      isAuthError('SUPERVISOR_NOT_ALLOWED'),
    );
    await assert.rejects(
      asRuntimeRole(client, context, 'cashier_reset', () => client.query(`SELECT public.prodx_supervisor_reset_failed_attempts($1, $2, $3, 'refund')`, [ids.org, ids.store, ids.cashier])),
      /not eligible/,
    );
    const cashierCredential = await client.query<{ failed_attempts: number }>('SELECT failed_attempts FROM public.prodx_user_credentials WHERE user_id = $1', [ids.cashier]);
    assert.equal(cashierCredential.rows[0].failed_attempts, 2);

    // Tenant isolation: another organization's supervisor (same username) is
    // invisible, and RPC arguments cannot escape the server-set tenant context.
    await assert.rejects(
      asRuntimeRole(client, context, 'cross_tenant_identity', () => service.authorize({ ...request, supervisorUsername: undefined, supervisorUserId: ids.otherSupervisor, supervisorSecret: SECRET })),
      isAuthError('INVALID_CREDENTIALS'),
    );
    for (const [name, sql, parameters] of [
      ['cross_org_find', 'SELECT * FROM public.prodx_supervisor_find_credential($1, $2, $3)', [ids.otherOrg, ids.otherStore, ids.otherSupervisor]],
      ['cross_store_find', 'SELECT * FROM public.prodx_supervisor_find_credential($1, $2, $3)', [ids.org, ids.otherStore, ids.supervisor]],
      ['cross_org_fail', 'SELECT public.prodx_supervisor_record_failed_attempt($1, $2, $3)', [ids.otherOrg, ids.otherStore, ids.otherSupervisor]],
      ['cross_org_reset', `SELECT public.prodx_supervisor_reset_failed_attempts($1, $2, $3, 'refund')`, [ids.otherOrg, ids.otherStore, ids.otherSupervisor]],
    ] as const) {
      await assert.rejects(
        asRuntimeRole(client, context, name, () => client.query(sql, [...parameters])),
        /outside the authenticated tenant context/,
        `${name} must fail closed`,
      );
    }
    await assert.rejects(
      (async () => {
        await client.query('SAVEPOINT missing_context');
        await client.query('SET LOCAL ROLE prodx_app');
        await client.query(
          `SELECT set_config('app.organization_id', '', true),
                  set_config('app.store_id', '', true),
                  set_config('app.user_id', '', true)`,
        );
        try {
          await client.query('SELECT * FROM public.prodx_supervisor_find_credential($1, $2, $3)', [ids.org, ids.store, ids.supervisor]);
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT missing_context');
          await client.query('RESET ROLE');
        }
      })(),
      /outside the authenticated tenant context/,
    );
    // A user ID inside the tenant but supplied for a foreign-org row must not be updated.
    await asRuntimeRole(client, context, 'foreign_user_fail', () => client.query('SELECT public.prodx_supervisor_record_failed_attempt($1, $2, $3)', [ids.org, ids.store, ids.otherSupervisor]));
    const foreign = await client.query<{ failed_attempts: number }>('SELECT failed_attempts FROM public.prodx_user_credentials WHERE user_id = $1', [ids.otherSupervisor]);
    assert.equal(foreign.rows[0].failed_attempts, 0);

    // Same-tenant identity with inactive membership in this store is invisible
    // to lookup and cannot have its failed-attempt counter changed.
    const nonMemberLookup = await asRuntimeRole(client, context, 'non_member_lookup', () =>
      client.query('SELECT * FROM public.prodx_supervisor_find_credential($1, $2, $3)',
        [ids.org, ids.store, ids.nonMemberSupervisor]));
    assert.deepEqual(nonMemberLookup.rows, []);
    await client.query('UPDATE public.prodx_user_credentials SET failed_attempts = 2 WHERE user_id = $1', [ids.nonMemberSupervisor]);
    await asRuntimeRole(client, context, 'non_member_failed_attempt', () =>
      client.query('SELECT public.prodx_supervisor_record_failed_attempt($1, $2, $3)',
        [ids.org, ids.store, ids.nonMemberSupervisor]));
    const nonMemberCredential = await client.query<{ failed_attempts: number }>(
      'SELECT failed_attempts FROM public.prodx_user_credentials WHERE user_id = $1', [ids.nonMemberSupervisor]);
    assert.equal(nonMemberCredential.rows[0].failed_attempts, 2);

    // A revoked requester membership also invalidates the database context,
    // even if the caller still supplies the old tenant/store/user GUC values.
    await client.query('UPDATE public.prodx_store_memberships SET active = FALSE WHERE organization_id = $1 AND store_id = $2 AND user_id = $3',
      [ids.org, ids.store, ids.requester]);
    await assert.rejects(
      asRuntimeRole(client, context, 'inactive_requester_membership', () =>
        client.query('SELECT * FROM public.prodx_supervisor_find_credential($1, $2, $3)',
          [ids.org, ids.store, ids.supervisor])),
      /outside the authenticated tenant context/,
    );
    await client.query('UPDATE public.prodx_store_memberships SET active = TRUE WHERE organization_id = $1 AND store_id = $2 AND user_id = $3',
      [ids.org, ids.store, ids.requester]);

    // Lockout: five failures lock the credential; the correct secret is then rejected.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await assert.rejects(
        asRuntimeRole(client, context, `lockout_${attempt}`, () => service.authorize({ ...request, supervisorSecret: 'wrong-secret' })),
        isAuthError('INVALID_CREDENTIALS'),
      );
    }
    const locked = await client.query<{ failed_attempts: number; locked: boolean }>(
      'SELECT failed_attempts, locked_until > CURRENT_TIMESTAMP AS locked FROM public.prodx_user_credentials WHERE user_id = $1', [ids.supervisor]);
    assert.deepEqual(locked.rows[0], { failed_attempts: 5, locked: true });
    await assert.rejects(
      asRuntimeRole(client, context, 'locked_correct_secret', () => service.authorize({ ...request, supervisorSecret: SECRET })),
      isAuthError('INVALID_CREDENTIALS'),
    );

    // Every outcome is recorded in the append-only security audit ledger.
    const audit = await client.query<{ event_type: string; count: number }>(`
      SELECT event_type, count(*)::int AS count FROM public.prodx_security_audit_events
       WHERE organization_id = $1 GROUP BY event_type ORDER BY event_type COLLATE "C"`, [ids.org]);
    assert.deepEqual(audit.rows, [
      { event_type: 'SUPERVISOR_AUTHORIZATION_CONSUMED', count: 1 },
      { event_type: 'SUPERVISOR_AUTHORIZATION_GRANTED', count: 1 },
      { event_type: 'SUPERVISOR_AUTHORIZATION_REPLAYED', count: 1 },
      { event_type: 'SUPERVISOR_AUTH_DENIED', count: 1 },
      { event_type: 'SUPERVISOR_AUTH_FAILED', count: 9 },
      { event_type: 'SUPERVISOR_AUTH_REJECTED', count: 2 },
    ]);
  } finally {
    await client.query('ROLLBACK');
  }
});
