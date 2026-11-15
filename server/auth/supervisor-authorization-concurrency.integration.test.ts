import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createPostgresPool, resolveConfiguredDatabaseUrl } from '../db/postgres';

const databaseUrl = resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);
const pool = databaseUrl ? createPostgresPool({ connectionString: databaseUrl, max: 3 }) : null;

test('supervisor reset serializes with concurrent store-membership revocation', async (t) => {
  if (!pool) {
    t.skip('DATABASE_URL is not configured; run with PostgreSQL migrations applied.');
    return;
  }

  const ids = { org: randomUUID(), store: randomUUID(), requester: randomUUID(), supervisor: randomUUID(), role: randomUUID(), permission: randomUUID() };
  const suffix = ids.org.replaceAll('-', '').slice(0, 12);
  const setup = await pool.connect();
  const revoker = await pool.connect();
  const authorizer = await pool.connect();

  try {
    await setup.query('BEGIN');
    await setup.query('INSERT INTO public.prodx_organizations (id, code, name) VALUES ($1, $2, $3)', [ids.org, `sup-race-${suffix}`, 'Supervisor race test']);
    await setup.query("INSERT INTO public.prodx_stores (id, organization_id, code, name, business_timezone) VALUES ($1, $2, $3, 'Supervisor race store', 'Asia/Bangkok')", [ids.store, ids.org, `sup-race-store-${suffix}`]);
    await setup.query("INSERT INTO public.prodx_users (id, organization_id, username, display_name, status) VALUES ($1, $3, $4, 'Requester', 'active'), ($2, $3, $5, 'Supervisor', 'active')", [ids.requester, ids.supervisor, ids.org, `sup-race-requester-${suffix}`, `sup-race-supervisor-${suffix}`]);
    await setup.query('INSERT INTO public.prodx_store_memberships (organization_id, store_id, user_id, active) VALUES ($1, $2, $3, TRUE), ($1, $2, $4, TRUE)', [ids.org, ids.store, ids.requester, ids.supervisor]);
    await setup.query("INSERT INTO public.prodx_roles (id, organization_id, role_key, name, active) VALUES ($1, $2, 'supervisor', 'Supervisor', TRUE)", [ids.role, ids.org]);
    await setup.query("INSERT INTO public.prodx_permissions (id, permission_key, description) VALUES ($1, 'pos.refund', 'Refund') ON CONFLICT (permission_key) DO NOTHING", [ids.permission]);
    const permission = await setup.query<{ id: string }>("SELECT id FROM public.prodx_permissions WHERE permission_key = 'pos.refund'");
    await setup.query('INSERT INTO public.prodx_role_permissions (organization_id, role_id, permission_id) VALUES ($1, $2, $3)', [ids.org, ids.role, permission.rows[0].id]);
    await setup.query('INSERT INTO public.prodx_user_roles (organization_id, store_id, user_id, role_id, active) VALUES ($1, $2, $3, $4, TRUE)', [ids.org, ids.store, ids.supervisor, ids.role]);
    await setup.query("INSERT INTO public.prodx_user_credentials (user_id, credential_type, secret_hash, failed_attempts) VALUES ($1, 'password', 'test-only-hash', 3)", [ids.supervisor]);
    await setup.query('COMMIT');

    const beginReset = async () => {
      await authorizer.query('BEGIN');
      await authorizer.query('SET LOCAL ROLE prodx_app');
      await authorizer.query("SELECT set_config('app.organization_id', $1, TRUE), set_config('app.store_id', $2, TRUE), set_config('app.user_id', $3, TRUE)", [ids.org, ids.store, ids.requester]);
      return authorizer.query('SELECT public.prodx_supervisor_reset_failed_attempts($1, $2, $3, $4)', [ids.org, ids.store, ids.supervisor, 'refund']);
    };

    // Revocation commits first: reset must wait, then reject against the new state.
    await revoker.query('BEGIN');
    await revoker.query('UPDATE public.prodx_store_memberships SET active = FALSE WHERE organization_id = $1 AND store_id = $2 AND user_id = $3', [ids.org, ids.store, ids.supervisor]);
    const resetAttempt = beginReset().then(() => null, (error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await revoker.query('COMMIT');
    const rejection = await resetAttempt;
    assert.ok(rejection, 'reset must reject after membership revocation commits');
    assert.equal((rejection as { code?: string }).code, '42501');
    await authorizer.query('ROLLBACK').catch(() => undefined);
    const revokedCredential = await setup.query<{ failed_attempts: number; last_authenticated_at: Date | null }>('SELECT failed_attempts, last_authenticated_at FROM public.prodx_user_credentials WHERE user_id = $1', [ids.supervisor]);
    assert.deepEqual(revokedCredential.rows[0], { failed_attempts: 3, last_authenticated_at: null });

    // Restore membership, then authorize first: revocation must wait until that
    // transaction commits, giving the two operations a deterministic serial order.
    await setup.query('UPDATE public.prodx_store_memberships SET active = TRUE WHERE organization_id = $1 AND store_id = $2 AND user_id = $3', [ids.org, ids.store, ids.supervisor]);
    await beginReset();
    let revokeFinished = false;
    const pendingRevocation = revoker.query('UPDATE public.prodx_store_memberships SET active = FALSE WHERE organization_id = $1 AND store_id = $2 AND user_id = $3', [ids.org, ids.store, ids.supervisor]).then(() => { revokeFinished = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(revokeFinished, false, 'revocation must wait for the in-flight authorization transaction');
    await authorizer.query('COMMIT');
    await pendingRevocation;
    const authorizedCredential = await setup.query<{ failed_attempts: number; last_authenticated_at: Date | null }>('SELECT failed_attempts, last_authenticated_at FROM public.prodx_user_credentials WHERE user_id = $1', [ids.supervisor]);
    assert.equal(authorizedCredential.rows[0].failed_attempts, 0);
    assert.ok(authorizedCredential.rows[0].last_authenticated_at);
  } finally {
    await setup.query('ROLLBACK').catch(() => undefined);
    await authorizer.query('ROLLBACK').catch(() => undefined);
    await revoker.query('ROLLBACK').catch(() => undefined);
    await setup.query('DELETE FROM public.prodx_organizations WHERE id = $1', [ids.org]).catch(() => undefined);
    setup.release();
    revoker.release();
    authorizer.release();
    await pool.end();
  }
});
