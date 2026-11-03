import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresPool, asSqlExecutor, resolveConfiguredDatabaseUrl } from '../db/postgres';
import { createPostgresAuthentication } from './composition';
import { createPostgresAuthenticationRepository } from './postgres-repository';
import { hashPassword } from './password';
import { hashSessionToken } from './session';

const databaseUrl = resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);

const ids = {
  organizationA: '00000000-0000-4000-8000-000000000201',
  organizationB: '00000000-0000-4000-8000-000000000202',
  storeA: '00000000-0000-4000-8000-000000000211',
  storeB: '00000000-0000-4000-8000-000000000212',
  userA: '00000000-0000-4000-8000-000000000221',
  userB: '00000000-0000-4000-8000-000000000222',
  deviceA: '00000000-0000-4000-8000-000000000231',
  deviceB: '00000000-0000-4000-8000-000000000232',
  supabaseUserA: '00000000-0000-4000-8000-000000000241',
  supabaseUserB: '00000000-0000-4000-8000-000000000242',
};

const pool = databaseUrl ? createPostgresPool({ connectionString: databaseUrl, max: 2 }) : null;
const authentication = pool
  ? createPostgresAuthentication(asSqlExecutor(pool), async () => ({ compromised: false, count: 0 }))
  : null;

const seed = async (): Promise<void> => {
  if (!pool) throw new Error('DATABASE_URL is required for PostgreSQL integration tests.');
  const passwordHash = await hashPassword('correct-password');
  await pool.query('DELETE FROM prodx_security_audit_events WHERE organization_id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
  await pool.query('DELETE FROM prodx_sessions WHERE organization_id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
  await pool.query('DELETE FROM prodx_store_memberships WHERE organization_id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
  await pool.query('DELETE FROM prodx_user_credentials WHERE user_id IN ($1, $2)', [ids.userA, ids.userB]);
  await pool.query('DELETE FROM prodx_devices WHERE id IN ($1, $2)', [ids.deviceA, ids.deviceB]);
  await pool.query('DELETE FROM prodx_users WHERE id IN ($1, $2)', [ids.userA, ids.userB]);
  await pool.query('DELETE FROM prodx_stores WHERE id IN ($1, $2)', [ids.storeA, ids.storeB]);
  await pool.query('DELETE FROM prodx_organizations WHERE id IN ($1, $2)', [ids.organizationA, ids.organizationB]);

  await pool.query(
    `INSERT INTO prodx_organizations (id, code, name) VALUES
      ($1, 'm2-a', 'M2 A'), ($2, 'm2-b', 'M2 B')`,
    [ids.organizationA, ids.organizationB],
  );
  await pool.query(
    `INSERT INTO prodx_stores (id, organization_id, code, name, business_timezone) VALUES
      ($1, $3, 'm2-store-a', 'M2 Store A', 'Asia/Bangkok'),
      ($2, $4, 'm2-store-b', 'M2 Store B', 'Asia/Bangkok')`,
    [ids.storeA, ids.storeB, ids.organizationA, ids.organizationB],
  );
  await pool.query(
    `INSERT INTO prodx_users (id, organization_id, username, display_name, supabase_auth_user_id) VALUES
      ($1, $3, 'm2-user-a', 'M2 User A', $5),
      ($2, $4, 'm2-user-b', 'M2 User B', $6)`,
    [ids.userA, ids.userB, ids.organizationA, ids.organizationB, ids.supabaseUserA, ids.supabaseUserB],
  );
  await pool.query(
    `INSERT INTO prodx_user_credentials (user_id, credential_type, secret_hash)
     VALUES ($1, 'password', $3), ($2, 'password', $3)`,
    [ids.userA, ids.userB, passwordHash],
  );
  await pool.query(
    `INSERT INTO prodx_devices (id, organization_id, store_id, device_key, name) VALUES
      ($1, $3, $5, 'm2-device-a', 'M2 Device A'),
      ($2, $4, $6, 'm2-device-b', 'M2 Device B')`,
    [ids.deviceA, ids.deviceB, ids.organizationA, ids.organizationB, ids.storeA, ids.storeB],
  );
  await pool.query(
    `INSERT INTO prodx_store_memberships (organization_id, store_id, user_id) VALUES ($1, $2, $3)`,
    [ids.organizationA, ids.storeA, ids.userA],
  );
};

const cleanup = async (): Promise<void> => {
  if (!pool) return;
  await pool.query('DELETE FROM prodx_security_audit_events WHERE organization_id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
  await pool.query('DELETE FROM prodx_sessions WHERE organization_id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
  await pool.query('DELETE FROM prodx_store_memberships WHERE organization_id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
  await pool.query('DELETE FROM prodx_user_credentials WHERE user_id IN ($1, $2)', [ids.userA, ids.userB]);
  await pool.query('DELETE FROM prodx_devices WHERE id IN ($1, $2)', [ids.deviceA, ids.deviceB]);
  await pool.query('DELETE FROM prodx_users WHERE id IN ($1, $2)', [ids.userA, ids.userB]);
  await pool.query('DELETE FROM prodx_stores WHERE id IN ($1, $2)', [ids.storeA, ids.storeB]);
  await pool.query('DELETE FROM prodx_organizations WHERE id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
};

test('M2 PostgreSQL authentication enforces credential, tenant, session, token-hash, lockout, and security-audit invariants', async (t) => {
  if (!pool || !authentication) {
    t.skip('DATABASE_URL is not configured; run server:test:integration with PostgreSQL.');
    return;
  }

  await seed();
  t.after(async () => {
    await cleanup();
    await pool.end();
  });

  const identityRepository = createPostgresAuthenticationRepository(asSqlExecutor(pool));
  const linkedIdentity = await identityRepository.findUserBySupabaseUserId(ids.supabaseUserA, ids.deviceA);
  assert.equal(linkedIdentity?.userId, ids.userA);

  // Supabase verifies the password; the POS identity mapping must not depend on
  // a synthetic local password credential being present.
  const savedCredential = await pool.query<{ secret_hash: string }>(
    'SELECT secret_hash FROM prodx_user_credentials WHERE user_id = $1', [ids.userA],
  );
  assert.equal(savedCredential.rows.length, 1);
  await pool.query('DELETE FROM prodx_user_credentials WHERE user_id = $1', [ids.userA]);
  try {
    assert.deepEqual(await identityRepository.findUserBySupabaseUserId(ids.supabaseUserA, ids.deviceA), {
      userId: ids.userA,
      organizationId: ids.organizationA,
      username: 'm2-user-a',
      status: 'active',
    });
  } finally {
    await pool.query(
      `INSERT INTO prodx_user_credentials (user_id, credential_type, secret_hash)
       VALUES ($1, 'password', $2)
       ON CONFLICT (user_id) DO UPDATE SET credential_type = EXCLUDED.credential_type, secret_hash = EXCLUDED.secret_hash`,
      [ids.userA, savedCredential.rows[0].secret_hash],
    );
  }

  assert.equal(await identityRepository.findUserBySupabaseUserId(ids.supabaseUserB, ids.deviceA), null,
    'a valid identity linked to another organization must not resolve on this device');
  assert.equal(await identityRepository.findUserBySupabaseUserId(ids.supabaseUserA, ids.deviceB), null,
    'a linked identity must not cross into another organization through a different device');
  await pool.query('UPDATE prodx_users SET supabase_auth_user_id = NULL WHERE id = $1', [ids.userA]);
  assert.equal(await identityRepository.findUserBySupabaseUserId(ids.supabaseUserA, ids.deviceA), null,
    'an unlinked Supabase subject must fail closed');
  await pool.query('UPDATE prodx_users SET supabase_auth_user_id = $2 WHERE id = $1', [ids.userA, ids.supabaseUserA]);

  const result = await authentication.authenticateCredentials({
    username: 'm2-user-a',
    password: 'correct-password',
    deviceId: ids.deviceA,
  });
  assert.ok(result);

  const persisted = await pool.query<{ token_hash: string; expires_at: Date; revoked_at: Date | null }>(
    'SELECT token_hash, expires_at, revoked_at FROM prodx_sessions WHERE id = $1',
    [result.sessionId],
  );
  assert.equal(persisted.rows.length, 1);
  assert.equal(persisted.rows[0].token_hash, hashSessionToken(result.token));
  assert.notEqual(persisted.rows[0].token_hash, result.token);
  assert.equal(persisted.rows[0].revoked_at, null);

  const beforeTouch = await pool.query<{ last_seen_at: Date | null }>(
    'SELECT last_seen_at FROM prodx_sessions WHERE id = $1',
    [result.sessionId],
  );
  const principal = await authentication.authenticateBearer(result.token);
  assert.deepEqual(principal, {
    sessionId: result.sessionId,
    userId: ids.userA,
    organizationId: ids.organizationA,
    storeId: ids.storeA,
  });
  const afterTouch = await pool.query<{ last_seen_at: Date | null }>(
    'SELECT last_seen_at FROM prodx_sessions WHERE id = $1',
    [result.sessionId],
  );
  assert.equal(afterTouch.rows[0].last_seen_at !== null, true);
  assert.equal(beforeTouch.rows[0].last_seen_at === null || afterTouch.rows[0].last_seen_at! >= beforeTouch.rows[0].last_seen_at!, true);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.equal(await authentication.authenticateCredentials({ username: 'm2-user-a', password: 'wrong-password', deviceId: ids.deviceA }), null);
  }
  const locked = await pool.query<{ failed_attempts: number; locked_until: Date | null }>(
    'SELECT failed_attempts, locked_until FROM prodx_user_credentials WHERE user_id = $1',
    [ids.userA],
  );
  assert.equal(locked.rows[0].failed_attempts, 5);
  assert.ok(locked.rows[0].locked_until);
  assert.ok(locked.rows[0].locked_until!.getTime() > Date.now());

  const audit = await pool.query<{ event_type: string; organization_id: string; user_id: string; metadata: { failed_attempts: number } }>(
    `SELECT event_type, organization_id, user_id, metadata
       FROM prodx_security_audit_events
      WHERE organization_id = $1
      ORDER BY occurred_at DESC`,
    [ids.organizationA],
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].event_type, 'AUTH_LOCKOUT');
  assert.equal(audit.rows[0].organization_id, ids.organizationA);
  assert.equal(audit.rows[0].user_id, ids.userA);
  assert.equal(audit.rows[0].metadata.failed_attempts, 5);

  assert.equal(await authentication.authenticateCredentials({ username: 'm2-user-a', password: 'correct-password', deviceId: ids.deviceA }), null);
  const stillLocked = await pool.query<{ failed_attempts: number; locked_until: Date | null }>(
    'SELECT failed_attempts, locked_until FROM prodx_user_credentials WHERE user_id = $1',
    [ids.userA],
  );
  assert.equal(stillLocked.rows[0].failed_attempts, 5);
  assert.equal(stillLocked.rows[0].locked_until?.getTime(), locked.rows[0].locked_until?.getTime());

  // Test successful reset without waiting 15 minutes by ending the test lock window in setup.
  await pool.query('UPDATE prodx_user_credentials SET locked_until = CURRENT_TIMESTAMP - INTERVAL \'1 second\' WHERE user_id = $1', [ids.userA]);
  const resetResult = await authentication.authenticateCredentials({ username: 'm2-user-a', password: 'correct-password', deviceId: ids.deviceA });
  assert.ok(resetResult);
  const resetState = await pool.query<{ failed_attempts: number; locked_until: Date | null }>(
    'SELECT failed_attempts, locked_until FROM prodx_user_credentials WHERE user_id = $1',
    [ids.userA],
  );
  assert.equal(resetState.rows[0].failed_attempts, 0);
  assert.equal(resetState.rows[0].locked_until, null);
  const resetAudit = await pool.query<{ event_type: string; metadata: { previous_failed_attempts: number } }>(
    `SELECT event_type, metadata FROM prodx_security_audit_events
      WHERE organization_id = $1 ORDER BY occurred_at ASC`,
    [ids.organizationA],
  );
  assert.equal(resetAudit.rows.length, 2);
  assert.equal(resetAudit.rows[1].event_type, 'AUTH_LOCKOUT_RESET');
  assert.equal(resetAudit.rows[1].metadata.previous_failed_attempts, 5);

  // Adversarial concurrency check: all callers start from the same unlocked state.
  // PostgreSQL must still cap the credential at the configured five failures.
  const concurrentFailures = await Promise.all(
    Array.from({ length: 12 }, () => authentication.authenticateCredentials({
      username: 'm2-user-a',
      password: 'wrong-password',
      deviceId: ids.deviceA,
    })),
  );
  assert.equal(concurrentFailures.filter((result) => result === null).length, 12);
  const concurrentState = await pool.query<{ failed_attempts: number; locked_until: Date | null }>(
    'SELECT failed_attempts, locked_until FROM prodx_user_credentials WHERE user_id = $1',
    [ids.userA],
  );
  assert.equal(concurrentState.rows[0].failed_attempts, 5);
  assert.ok(concurrentState.rows[0].locked_until);

  await pool.query('UPDATE prodx_user_credentials SET locked_until = CURRENT_TIMESTAMP - INTERVAL \'1 second\' WHERE user_id = $1', [ids.userA]);
  const postConcurrencyReset = await authentication.authenticateCredentials({
    username: 'm2-user-a',
    password: 'correct-password',
    deviceId: ids.deviceA,
  });
  assert.ok(postConcurrencyReset);

  const crossTenantDevice = await authentication.authenticateCredentials({
    username: 'm2-user-a',
    password: 'correct-password',
    deviceId: ids.deviceB,
  });
  assert.equal(crossTenantDevice, null);

  await pool.query('UPDATE prodx_users SET status = \'disabled\' WHERE id = $1', [ids.userA]);
  assert.equal(await authentication.authenticateCredentials({ username: 'm2-user-a', password: 'correct-password', deviceId: ids.deviceA }), null);
  await pool.query('UPDATE prodx_users SET status = \'active\' WHERE id = $1', [ids.userA]);

  await pool.query('UPDATE prodx_devices SET status = \'disabled\' WHERE id = $1', [ids.deviceA]);
  assert.equal(await authentication.authenticateCredentials({ username: 'm2-user-a', password: 'correct-password', deviceId: ids.deviceA }), null);
  await pool.query('UPDATE prodx_devices SET status = \'active\' WHERE id = $1', [ids.deviceA]);

  await pool.query('UPDATE prodx_sessions SET issued_at = CURRENT_TIMESTAMP - INTERVAL \'2 minutes\', expires_at = CURRENT_TIMESTAMP - INTERVAL \'1 minute\' WHERE id = $1', [result.sessionId]);
  assert.equal(await authentication.authenticateBearer(result.token), null);

  const fresh = await authentication.authenticateCredentials({ username: 'm2-user-a', password: 'correct-password', deviceId: ids.deviceA });
  assert.ok(fresh);
  await pool.query('UPDATE prodx_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1', [fresh.sessionId]);
  assert.equal(await authentication.authenticateBearer(fresh.token), null);
});
