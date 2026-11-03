import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { hashPassword } from '../auth/password';
import { resolveConfiguredDatabaseUrl } from '../db/postgres';
import { createProductionApp } from '../entrypoint';

const databaseUrl = resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);
const localClientFingerprints = ['127.0.0.1', '::ffff:127.0.0.1', '::1'].map((address) =>
  createHash('sha256').update(address).digest('hex'),
);

const ids = {
  organizationA: '00000000-0000-4000-8000-000000000301',
  organizationB: '00000000-0000-4000-8000-000000000302',
  storeA: '00000000-0000-4000-8000-000000000311',
  storeB: '00000000-0000-4000-8000-000000000312',
  userA: '00000000-0000-4000-8000-000000000321',
  userB: '00000000-0000-4000-8000-000000000322',
  deviceA: '00000000-0000-4000-8000-000000000331',
  deviceB: '00000000-0000-4000-8000-000000000332',
};

test('production auth HTTP boundary enforces login scope, session revocation, malformed bearer rejection, and store isolation', async (t) => {
  if (!databaseUrl) {
    t.skip('DATABASE_URL is not configured; run server:test:integration with PostgreSQL.');
    return;
  }

  const { app, pool } = await createProductionApp();
  const passwordHash = await hashPassword('correct-password');
  // Password-compromise screening is covered by its dedicated tests. Keep this
  // database/HTTP boundary test deterministic and independent of HIBP availability.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://api.pwnedpasswords.com/range/')) {
      return new Response('', { status: 200 });
    }
    return originalFetch(input, init);
  };

  const cleanup = async () => {
    globalThis.fetch = originalFetch;
    await pool.query('DELETE FROM prodx_auth_login_throttles WHERE client_fingerprint = ANY($1::text[])', [localClientFingerprints]);
    await pool.query('DELETE FROM prodx_security_audit_events WHERE organization_id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
    await pool.query('DELETE FROM prodx_sessions WHERE organization_id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
    await pool.query('DELETE FROM prodx_user_roles WHERE organization_id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
    await pool.query('DELETE FROM prodx_role_permissions WHERE organization_id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
    await pool.query('DELETE FROM prodx_roles WHERE organization_id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
    await pool.query('DELETE FROM prodx_user_credentials WHERE user_id IN ($1, $2)', [ids.userA, ids.userB]);
    await pool.query('DELETE FROM prodx_store_memberships WHERE organization_id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
    await pool.query('DELETE FROM prodx_devices WHERE id IN ($1, $2)', [ids.deviceA, ids.deviceB]);
    await pool.query('DELETE FROM prodx_users WHERE id IN ($1, $2)', [ids.userA, ids.userB]);
    await pool.query('DELETE FROM prodx_stores WHERE id IN ($1, $2)', [ids.storeA, ids.storeB]);
    await pool.query('DELETE FROM prodx_organizations WHERE id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
    await pool.end();
  };

  await pool.query('DELETE FROM prodx_auth_login_throttles WHERE client_fingerprint = ANY($1::text[])', [localClientFingerprints]);
  await pool.query('DELETE FROM prodx_security_audit_events WHERE organization_id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
  await pool.query('DELETE FROM prodx_sessions WHERE organization_id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
  await pool.query('DELETE FROM prodx_user_roles WHERE organization_id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
  await pool.query('DELETE FROM prodx_role_permissions WHERE organization_id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
  await pool.query('DELETE FROM prodx_roles WHERE organization_id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
  await pool.query('DELETE FROM prodx_user_credentials WHERE user_id IN ($1, $2)', [ids.userA, ids.userB]);
  await pool.query('DELETE FROM prodx_store_memberships WHERE organization_id IN ($1, $2)', [ids.organizationA, ids.organizationB]);
  await pool.query('DELETE FROM prodx_devices WHERE id IN ($1, $2)', [ids.deviceA, ids.deviceB]);
  await pool.query('DELETE FROM prodx_users WHERE id IN ($1, $2)', [ids.userA, ids.userB]);
  await pool.query('DELETE FROM prodx_stores WHERE id IN ($1, $2)', [ids.storeA, ids.storeB]);
  await pool.query('DELETE FROM prodx_organizations WHERE id IN ($1, $2)', [ids.organizationA, ids.organizationB]);

  await pool.query('INSERT INTO prodx_organizations (id, code, name) VALUES ($1, $3, $3), ($2, $4, $4)', [
    ids.organizationA, ids.organizationB, 'http-a', 'http-b',
  ]);
  await pool.query(
    `INSERT INTO prodx_stores (id, organization_id, code, name, business_timezone) VALUES
      ($1, $3, 'store-a', 'HTTP Store A', 'Asia/Bangkok'),
      ($2, $4, 'store-b', 'HTTP Store B', 'Asia/Bangkok')`,
    [ids.storeA, ids.storeB, ids.organizationA, ids.organizationB],
  );
  await pool.query(
    `INSERT INTO prodx_users (id, organization_id, username, display_name) VALUES
      ($1, $3, 'http-user-a', 'HTTP User A'),
      ($2, $4, 'http-user-b', 'HTTP User B')`,
    [ids.userA, ids.userB, ids.organizationA, ids.organizationB],
  );
  await pool.query(
    `INSERT INTO prodx_user_credentials (user_id, credential_type, secret_hash)
     VALUES ($1, 'password', $3), ($2, 'password', $3)`,
    [ids.userA, ids.userB, passwordHash],
  );
  await pool.query(
    `INSERT INTO prodx_devices (id, organization_id, store_id, device_key, name) VALUES
      ($1, $3, $5, 'device-a', 'HTTP Device A'),
      ($2, $4, $6, 'device-b', 'HTTP Device B')`,
    [ids.deviceA, ids.deviceB, ids.organizationA, ids.organizationB, ids.storeA, ids.storeB],
  );
  await pool.query(
    `INSERT INTO prodx_store_memberships (organization_id, store_id, user_id) VALUES ($1, $2, $3)`,
    [ids.organizationA, ids.storeA, ids.userA],
  );

  t.after(cleanup);

  const server = app.listen(0);
  t.after(async () => new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => error ? reject(error) : resolve());
  }));

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const request = (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init);

  const invalidLogin = await request('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationSlug: 'http-a', storeCode: 'store-a', emailOrPin: 'http-user-a', passwordOrPin: 'wrong', registerId: 'device-a' }),
  });
  assert.equal(invalidLogin.status, 401);

  const login = await request('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationSlug: 'http-a', storeCode: 'store-a', emailOrPin: 'http-user-a', passwordOrPin: 'correct-password', registerId: 'device-a' }),
  });
  assert.equal(login.status, 200);
  const session = await login.json() as { token: string; currentStore: { id: string }; registerId: string };
  assert.ok(session.token);
  assert.equal(session.currentStore.id, ids.storeA);
  assert.equal(session.registerId, 'device-a');

  const current = await request('/auth/session', { headers: { authorization: `Bearer ${session.token}` } });
  assert.equal(current.status, 200);
  assert.equal((await current.json() as { currentStore: { id: string } }).currentStore.id, ids.storeA);

  const malformed = await request('/auth/session', { headers: { authorization: 'Bearer definitely-not-a-valid-session' } });
  assert.equal(malformed.status, 401);

  const crossStore = await request('/organizations/http-b/stores', { headers: { authorization: `Bearer ${session.token}` } });
  assert.equal(crossStore.status, 200);
  assert.deepEqual(await crossStore.json(), []);

  const stores = await request('/organizations/http-a/stores', { headers: { authorization: `Bearer ${session.token}` } });
  assert.equal(stores.status, 200);
  const visibleStores = await stores.json() as Array<{ id: string }>;
  assert.deepEqual(visibleStores.map((store) => store.id), [ids.storeA]);

  const logout = await request('/auth/logout', {
    method: 'POST',
    headers: { authorization: `Bearer ${session.token}` },
  });
  assert.equal(logout.status, 204);

  const afterLogout = await request('/auth/session', { headers: { authorization: `Bearer ${session.token}` } });
  assert.equal(afterLogout.status, 401);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const lockedAttempt = await request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationSlug: 'http-b', storeCode: 'store-b', emailOrPin: 'http-user-b', passwordOrPin: 'wrong', registerId: 'device-b' }),
    });
    assert.equal(lockedAttempt.status, 401);
  }

  const lockedLogin = await request('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationSlug: 'http-b', storeCode: 'store-b', emailOrPin: 'http-user-b', passwordOrPin: 'correct-password', registerId: 'device-b' }),
  });
  assert.equal(lockedLogin.status, 401);

  const freshLogin = await request('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationSlug: 'http-a', storeCode: 'store-a', emailOrPin: 'http-user-a', passwordOrPin: 'correct-password', registerId: 'device-a' }),
  });
  assert.equal(freshLogin.status, 200);
  const expiringSession = await freshLogin.json() as { token: string };
  const expiredTokenHash = createHash('sha256').update(expiringSession.token).digest('hex');
  await pool.query(`UPDATE prodx_sessions SET issued_at = CURRENT_TIMESTAMP - INTERVAL '2 seconds', expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE token_hash = $1`, [expiredTokenHash]);
  const expired = await request('/auth/session', { headers: { authorization: `Bearer ${expiringSession.token}` } });
  assert.equal(expired.status, 401);

  const missingField = await request('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationSlug: 'http-a', storeCode: 'store-a', emailOrPin: 'http-user-a', registerId: 'device-a' }),
  });
  assert.equal(missingField.status, 400);

  const wrongDeviceStore = await request('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationSlug: 'http-a', storeCode: 'store-a', emailOrPin: 'http-user-a', passwordOrPin: 'correct-password', registerId: 'device-b' }),
  });
  assert.equal(wrongDeviceStore.status, 401);

  const activeBeforeDisable = await request('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationSlug: 'http-a', storeCode: 'store-a', emailOrPin: 'http-user-a', passwordOrPin: 'correct-password', registerId: 'device-a' }),
  });
  assert.equal(activeBeforeDisable.status, 200);
  const activeSession = await activeBeforeDisable.json() as { token: string };

  // Re-enable userA to verify Admin vs POS authentication separation & RBAC role gate
  await pool.query(`UPDATE prodx_users SET status = 'active' WHERE id = $1`, [ids.userA]);

  // userA currently has 'cashier' role; attempting /auth/admin/login must be rejected with 403 ADMIN_ROLE_REQUIRED
  const nonAdminConsoleAttempt = await request('/auth/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      organizationSlug: 'http-a',
      storeCode: 'store-a',
      emailOrPin: 'http-user-a',
      passwordOrPin: 'correct-password',
      registerId: 'device-a',
    }),
  });
  assert.equal(nonAdminConsoleAttempt.status, 403);
  const nonAdminBody = (await nonAdminConsoleAttempt.json()) as { error?: { code?: string } };
  assert.equal(nonAdminBody.error?.code, 'ADMIN_ROLE_REQUIRED');

  // Grant 'admin' role and 'rbac.manage' permission to userA and verify /auth/admin/login succeeds
  const adminRoleId = randomUUID();
  await pool.query(
    `INSERT INTO prodx_roles (id, organization_id, role_key, name, active)
     VALUES ($1, $2, 'admin', 'Administrator', TRUE)`,
    [adminRoleId, ids.organizationA],
  );
  await pool.query(
    `INSERT INTO prodx_permissions (id, permission_key, description)
     VALUES ($1, 'rbac.manage', 'Manage RBAC')
     ON CONFLICT (permission_key) DO NOTHING`,
    [randomUUID()],
  );
  const rbacPermRow = await pool.query<{ id: string }>(
    `SELECT id FROM prodx_permissions WHERE permission_key = 'rbac.manage' LIMIT 1`,
  );
  await pool.query(
    `INSERT INTO prodx_role_permissions (organization_id, role_id, permission_id)
     VALUES ($1, $2, $3)`,
    [ids.organizationA, adminRoleId, rbacPermRow.rows[0].id],
  );
  await pool.query(
    `INSERT INTO prodx_user_roles (organization_id, store_id, user_id, role_id, active)
     VALUES ($1, $2, $3, $4, TRUE)`,
    [ids.organizationA, ids.storeA, ids.userA, adminRoleId],
  );

  const adminLoginSuccess = await request('/auth/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      organizationSlug: 'http-a',
      storeCode: 'store-a',
      emailOrPin: 'http-user-a',
      passwordOrPin: 'correct-password',
      registerId: 'device-a',
      requireAdminRole: true,
    }),
  });
  assert.equal(adminLoginSuccess.status, 200);
  const adminSession = (await adminLoginSuccess.json()) as {
    currentUser: { role: string; permissions: string[] };
  };
  assert.equal(adminSession.currentUser.role, 'admin');
  assert.equal(adminSession.currentUser.permissions.includes('org:manage'), true);
  assert.equal(adminSession.currentUser.permissions.includes('rbac:manage'), true);

  await pool.query(`UPDATE prodx_users SET status = 'disabled' WHERE id = $1`, [ids.userA]);

  const disabledLogin = await request('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationSlug: 'http-a', storeCode: 'store-a', emailOrPin: 'http-user-a', passwordOrPin: 'correct-password', registerId: 'device-a' }),
  });
  assert.equal(disabledLogin.status, 401);

  const disabledSession = await request('/auth/session', { headers: { authorization: `Bearer ${activeSession.token}` } });
  assert.equal(disabledSession.status, 401);
});

