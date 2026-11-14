import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createPostgresPool, resolveConfiguredDatabaseUrl } from '../db/postgres';

const databaseUrl = resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);
const pool = databaseUrl ? createPostgresPool({ connectionString: databaseUrl, max: 1 }) : null;

test('security audit events reject UPDATE, DELETE, and TRUNCATE, including for the database owner', async (t) => {
  if (!pool) {
    t.skip('DATABASE_URL is not configured; run with PostgreSQL migrations applied.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const organizationId = randomUUID();
    const userId = randomUUID();
    const otherOrganizationId = randomUUID();
    const otherUserId = randomUUID();
    const storeId = randomUUID();
    const eventId = randomUUID();

    const trigger = await client.query<{ tgenabled: string }>(`
      SELECT t.tgenabled
        FROM pg_catalog.pg_trigger t
       WHERE t.tgrelid = 'public.prodx_security_audit_events'::regclass
         AND t.tgname = 'prodx_security_audit_events_immutable_guard'
         AND NOT t.tgisinternal
    `);
    assert.equal(trigger.rows[0]?.tgenabled, 'A', 'immutability trigger must be ENABLE ALWAYS');

    const truncateTrigger = await client.query<{ tgenabled: string }>(`
      SELECT t.tgenabled
        FROM pg_catalog.pg_trigger t
       WHERE t.tgrelid = 'public.prodx_security_audit_events'::regclass
         AND t.tgname = 'prodx_security_audit_events_no_truncate_guard'
         AND NOT t.tgisinternal
    `);
    assert.equal(truncateTrigger.rows[0]?.tgenabled, 'A', 'TRUNCATE guard must be ENABLE ALWAYS');

    const foreignKeys = await client.query<{ count: string }>(`
      SELECT count(*)::text AS count
        FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.prodx_security_audit_events'::regclass
         AND contype = 'f'
    `);
    assert.equal(foreignKeys.rows[0]?.count, '0', 'historical identity references must not be mutated by FK actions');

    await client.query(`
      INSERT INTO public.prodx_organizations (id, code, name)
      VALUES ($1, $2, 'Audit Immutability Test')
    `, [organizationId, `audit-immutability-${eventId}`]);
    await client.query(`
      INSERT INTO public.prodx_users (id, organization_id, username, display_name, status)
      VALUES ($1, $2, $3, 'Audit Test User', 'active')
    `, [userId, organizationId, `audit-${eventId}@example.invalid`]);
    await client.query(`
      INSERT INTO public.prodx_organizations (id, code, name)
      VALUES ($1, $2, 'Other Audit Test Organization')
    `, [otherOrganizationId, `audit-other-${eventId}`]);
    await client.query(`
      INSERT INTO public.prodx_users (id, organization_id, username, display_name, status)
      VALUES ($1, $2, $3, 'Other Audit Test User', 'active')
    `, [otherUserId, otherOrganizationId, `audit-other-${eventId}@example.invalid`]);
    await client.query(`
      INSERT INTO public.prodx_stores (id, organization_id, code, name, business_timezone)
      VALUES ($1, $2, $3, 'Audit Immutability Store', 'Asia/Bangkok')
    `, [storeId, organizationId, `audit-store-${eventId}`]);

    await client.query(`
      INSERT INTO public.prodx_security_audit_events
        (id, organization_id, user_id, event_type, metadata)
      VALUES ($1, $2, $3, 'IMMUTABILITY_TEST', '{"test":true}'::jsonb)
    `, [eventId, organizationId, userId]);

    // The backend runtime role is intentionally SELECT-only on this table.
    await client.query('SET LOCAL ROLE prodx_app');
    assert.equal((await client.query<{ current_user: string }>('SELECT current_user')).rows[0]?.current_user, 'prodx_app');
    await client.query(
      `SELECT set_config('app.organization_id', $1, true),
              set_config('app.store_id', $2, true),
              set_config('app.user_id', $3, true)`,
      [organizationId, storeId, userId],
    );
    const rpcPrivilege = await client.query<{ allowed: boolean }>(
      `SELECT has_function_privilege('prodx_app',
        'public.prodx_record_supervisor_authorization_event(uuid,uuid,uuid,uuid,text,jsonb)', 'EXECUTE') AS allowed`,
    );
    assert.equal(rpcPrivilege.rows[0]?.allowed, true, 'runtime role must execute only the scoped audit RPC');
    const auditRpc = `SELECT public.prodx_record_supervisor_authorization_event($1, $2, $3, $4, $5, $6::jsonb)`;
    const commonMetadata = { action: 'refund', orderId: eventId, requesterUserId: userId };
    await client.query(auditRpc, [randomUUID(), organizationId, storeId, null, 'SUPERVISOR_AUTH_REJECTED', JSON.stringify({ ...commonMetadata, reason: 'invalid_or_locked' })]);
    await client.query(auditRpc, [randomUUID(), organizationId, storeId, userId, 'SUPERVISOR_AUTH_FAILED', JSON.stringify(commonMetadata)]);
    await client.query(auditRpc, [randomUUID(), organizationId, storeId, userId, 'SUPERVISOR_AUTH_DENIED', JSON.stringify({ ...commonMetadata, reason: 'store_permission_missing' })]);
    await client.query(auditRpc, [randomUUID(), organizationId, storeId, userId, 'SUPERVISOR_AUTHORIZATION_GRANTED', JSON.stringify({
      ...commonMetadata, requesterSessionId: randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })]);
    const rpcEvent = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.prodx_security_audit_events
        WHERE organization_id = $1 AND event_type IN (
          'SUPERVISOR_AUTH_REJECTED', 'SUPERVISOR_AUTH_FAILED',
          'SUPERVISOR_AUTH_DENIED', 'SUPERVISOR_AUTHORIZATION_GRANTED'
        )`,
      [organizationId],
    );
    assert.equal(rpcEvent.rows[0]?.count, '4', 'scoped SECURITY DEFINER RPC must persist all four allowed supervisor event types for prodx_app');
    await client.query('SAVEPOINT before_cross_tenant_audit_rpc');
    await assert.rejects(
      client.query(
        `SELECT public.prodx_record_supervisor_authorization_event($1, $2, $3, $4, $5, $6::jsonb)`,
        [randomUUID(), otherOrganizationId, storeId, otherUserId, 'SUPERVISOR_AUTH_FAILED', JSON.stringify({
          action: 'refund', orderId: eventId, requesterUserId: userId,
        })],
      ),
      /outside the authenticated tenant context/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT before_cross_tenant_audit_rpc');
    await client.query('SAVEPOINT before_sensitive_audit_metadata');
    await assert.rejects(
      client.query(
        `SELECT public.prodx_record_supervisor_authorization_event($1, $2, $3, $4, $5, $6::jsonb)`,
        [randomUUID(), organizationId, storeId, userId, 'SUPERVISOR_AUTH_FAILED', JSON.stringify({
          action: 'refund', orderId: eventId, requesterUserId: userId, password: 'must-not-be-recorded',
        })],
      ),
      /unsupported fields/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT before_sensitive_audit_metadata');
    await client.query('SAVEPOINT before_runtime_insert');
    await assert.rejects(
      client.query(`
        INSERT INTO public.prodx_security_audit_events
          (id, organization_id, user_id, event_type, metadata)
        VALUES ($1, $2, $3, 'RUNTIME_DIRECT_INSERT', '{}'::jsonb)
      `, [randomUUID(), organizationId, userId]),
      /permission denied/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT before_runtime_insert');
    await client.query('SAVEPOINT before_runtime_update');
    await assert.rejects(
      client.query('UPDATE public.prodx_security_audit_events SET metadata = \'{}\'::jsonb WHERE id = $1', [eventId]),
      /permission denied/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT before_runtime_update');
    await client.query('SAVEPOINT before_runtime_delete');
    await assert.rejects(
      client.query('DELETE FROM public.prodx_security_audit_events WHERE id = $1', [eventId]),
      /permission denied/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT before_runtime_delete');
    await client.query('SAVEPOINT before_runtime_truncate');
    await assert.rejects(
      client.query('TRUNCATE TABLE public.prodx_security_audit_events'),
      /permission denied/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT before_runtime_truncate');
    await client.query('RESET ROLE');

    await client.query('SAVEPOINT before_invalid_audit_insert');
    await assert.rejects(
      client.query(`
        INSERT INTO public.prodx_security_audit_events
          (id, organization_id, user_id, event_type, metadata)
        VALUES ($1, $2, $3, 'INVALID_TENANT_USER', '{}'::jsonb)
      `, [randomUUID(), organizationId, otherUserId]),
      /does not belong to the organization/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT before_invalid_audit_insert');

    await client.query('SAVEPOINT before_audit_update');
    await assert.rejects(
      client.query(
        'UPDATE public.prodx_security_audit_events SET metadata = $2 WHERE id = $1',
        [eventId, JSON.stringify({ changed: true })],
      ),
      /append-only/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT before_audit_update');

    await client.query('SAVEPOINT before_audit_delete');
    await assert.rejects(
      client.query('DELETE FROM public.prodx_security_audit_events WHERE id = $1', [eventId]),
      /append-only/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT before_audit_delete');

    await client.query('SAVEPOINT before_audit_truncate');
    await assert.rejects(
      client.query('TRUNCATE TABLE public.prodx_security_audit_events'),
      /append-only/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT before_audit_truncate');

    // Replication apply normally suppresses origin triggers. ENABLE ALWAYS must
    // still enforce the audit-event contract when the session is in replica mode.
    await client.query("SET LOCAL session_replication_role = 'replica'");
    const replicaEventId = randomUUID();

    await client.query(`
      INSERT INTO public.prodx_security_audit_events
        (id, organization_id, user_id, event_type, metadata)
      VALUES ($1, $2, $3, 'REPLICA_MODE_VALID_INSERT', '{"replicaMode":true}'::jsonb)
    `, [replicaEventId, organizationId, userId]);

    await client.query('SAVEPOINT before_replica_invalid_insert');
    await assert.rejects(
      client.query(`
        INSERT INTO public.prodx_security_audit_events
          (id, organization_id, user_id, event_type, metadata)
        VALUES ($1, $2, $3, 'REPLICA_MODE_INVALID_TENANT_USER', '{}'::jsonb)
      `, [randomUUID(), organizationId, otherUserId]),
      /does not belong to the organization/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT before_replica_invalid_insert');

    await client.query('SAVEPOINT before_replica_audit_update');
    await assert.rejects(
      client.query(
        'UPDATE public.prodx_security_audit_events SET metadata = $2 WHERE id = $1',
        [replicaEventId, JSON.stringify({ changed: true })],
      ),
      /append-only/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT before_replica_audit_update');

    await client.query('SAVEPOINT before_replica_audit_delete');
    await assert.rejects(
      client.query('DELETE FROM public.prodx_security_audit_events WHERE id = $1', [replicaEventId]),
      /append-only/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT before_replica_audit_delete');

    await client.query('SAVEPOINT before_replica_audit_truncate');
    await assert.rejects(
      client.query('TRUNCATE TABLE public.prodx_security_audit_events'),
      /append-only/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT before_replica_audit_truncate');

    // Restore normal trigger behavior before exercising entity-retention checks.
    await client.query("SET LOCAL session_replication_role = 'origin'");

    await client.query('DELETE FROM public.prodx_users WHERE id = $1', [userId]);
    await client.query('DELETE FROM public.prodx_stores WHERE id = $1', [storeId]);
    await client.query('DELETE FROM public.prodx_organizations WHERE id = $1', [organizationId]);

    const retained = await client.query<{ count: string; organization_id: string; user_id: string }>(
      'SELECT count(*)::text AS count, max(organization_id::text) AS organization_id, max(user_id::text) AS user_id FROM public.prodx_security_audit_events WHERE id = $1',
      [eventId],
    );
    assert.equal(retained.rows[0]?.count, '1');
    assert.equal(retained.rows[0]?.organization_id, organizationId);
    assert.equal(retained.rows[0]?.user_id, userId);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
