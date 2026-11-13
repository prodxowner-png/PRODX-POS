import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createPostgresPool, resolveConfiguredDatabaseUrl } from '../db/postgres';

const databaseUrl = resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);
const pool = databaseUrl ? createPostgresPool({ connectionString: databaseUrl, max: 1 }) : null;

test('security audit events reject UPDATE and DELETE, including for the database owner', async (t) => {
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
    const eventId = randomUUID();

    const trigger = await client.query<{ tgenabled: string }>(`
      SELECT t.tgenabled
        FROM pg_catalog.pg_trigger t
       WHERE t.tgrelid = 'public.prodx_security_audit_events'::regclass
         AND t.tgname = 'prodx_security_audit_events_immutable_guard'
         AND NOT t.tgisinternal
    `);
    assert.equal(trigger.rows[0]?.tgenabled, 'A', 'immutability trigger must be ENABLE ALWAYS');

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
      INSERT INTO public.prodx_security_audit_events
        (id, organization_id, user_id, event_type, metadata)
      VALUES ($1, $2, $3, 'IMMUTABILITY_TEST', '{"test":true}'::jsonb)
    `, [eventId, organizationId, userId]);

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

    await client.query('DELETE FROM public.prodx_users WHERE id = $1', [userId]);
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
