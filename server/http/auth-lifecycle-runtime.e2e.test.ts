import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { SignJWT } from 'jose';
import type { QueryResultRow } from 'pg';
import { createPostgresAuthenticationRepository } from '../auth/postgres-repository';
import { createPostgresAuthorization } from '../auth/production-authorization';
import { verifyPassword } from '../auth/password';
import { createSessionIssuer, createSupabaseTokenVerifier, hashSessionToken } from '../auth/session';
import { asSqlExecutor, createPostgresPool } from '../db/postgres';
import { assertDisposableTestDatabaseUrl } from '../db/test-database-guard';
import { createTransactionalPostgresExecutor } from '../db/transaction';
import { registerAuthRoutes } from './auth-route';
import { createApp } from './createApp';
import { registerDiscountPolicyRoute } from './discount-policy-route';

const configuredDatabaseUrl = process.env.DATABASE_URL?.trim();
const databaseUrl = configuredDatabaseUrl
  ? assertDisposableTestDatabaseUrl(configuredDatabaseUrl, 'server/http/auth-lifecycle-runtime.e2e.test.ts')
  : null;

const signRs256Jwt = async (params: {
  privateKey: crypto.KeyObject;
  kid: string;
  issuer: string;
  subject: string;
  expiresInSeconds: number;
}): Promise<string> => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'RS256', kid: params.kid, typ: 'JWT' })
    .setIssuer(params.issuer)
    .setAudience('authenticated')
    .setSubject(params.subject)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + params.expiresInSeconds)
    .sign(params.privateKey);
};

test('Auth runtime E2E: Sign-in -> Token Exchange -> RBAC -> Protected API -> Renewal -> Protected API -> Logout -> Revocation -> Audit', async (t) => {
  if (!databaseUrl) {
    t.skip('DATABASE_URL is not configured; run with PostgreSQL.');
    return;
  }

  // 1. Start a real local HTTP JWKS server with a freshly generated RSA keypair.
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const { privateKey: untrustedPrivateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'e2e-rsa-' + randomUUID().slice(0, 8);
  const publicJwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid,
    use: 'sig',
    alg: 'RS256',
  };

  let jwksRequestCount = 0;
  const jwksServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/auth/v1/.well-known/jwks.json') {
      jwksRequestCount += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => jwksServer.close((err) => (err ? reject(err) : resolve())));
  });
  const jwksAddress = jwksServer.address();
  assert.ok(jwksAddress && typeof jwksAddress === 'object');
  const jwksBaseUrl = `http://127.0.0.1:${jwksAddress.port}`;
  const jwksIssuer = `${jwksBaseUrl}/auth/v1`;

  // 2. Connect real PostgreSQL pool and wire the real production Express app stack.
  const pool = createPostgresPool({ connectionString: databaseUrl, max: 8 });
  t.after(async () => {
    await pool.end();
  });

  const sql = asSqlExecutor(pool);
  const transactions = createTransactionalPostgresExecutor(pool);
  const requestScopedSql = {
    async query<T extends Record<string, unknown>>(statement: string, parameters: readonly unknown[] = []): Promise<readonly T[]> {
      const result = await transactions.query<T & QueryResultRow>(statement, parameters);
      return result.rows;
    },
  };
  const verifySupabaseIdentity = createSupabaseTokenVerifier(
    jwksBaseUrl,
    `${jwksBaseUrl}/auth/v1/.well-known/jwks.json`,
  );
  const sessions = createSessionIssuer(
    createPostgresAuthenticationRepository(sql),
    verifyPassword,
    () => new Date(),
    async () => ({ compromised: false, count: 0 }),
    verifySupabaseIdentity,
  );
  const authorize = createPostgresAuthorization(requestScopedSql);

  const app = createApp({
    authenticateRequest: async (request) => {
      const header = request.header('authorization');
      if (!header?.startsWith('Bearer ')) return null;
      return sessions.authenticateBearer(header.slice('Bearer '.length).trim());
    },
    authorizeRequest: authorize,
    configurePublicRoutes: (configuredApp) => {
      registerAuthRoutes(configuredApp, requestScopedSql, sessions, {
        supabaseSessionEnabled: true,
      });
    },
    configureRoutes: (configuredApp) => {
      registerDiscountPolicyRoute(configuredApp, transactions);
    },
  });

  const apiServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => apiServer.once('listening', resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => apiServer.close((err) => (err ? reject(err) : resolve())));
  });
  const apiAddress = apiServer.address();
  assert.ok(apiAddress && typeof apiAddress === 'object');
  const apiBaseUrl = `http://127.0.0.1:${apiAddress.port}`;

  // 3. Seed isolated two-tenant fixtures in PostgreSQL.
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = {
    orgA: randomUUID(),
    orgB: randomUUID(),
    storeA: randomUUID(),
    storeB: randomUUID(),
    ownerA: randomUUID(),
    cashierA: randomUUID(),
    userB: randomUUID(),
    supabaseOwnerA: randomUUID(),
    supabaseCashierA: randomUUID(),
    supabaseUserB: randomUUID(),
    roleOwnerA: randomUUID(),
    roleCashierA: randomUUID(),
    deviceAdminA: randomUUID(),
    devicePosA: randomUUID(),
    devicePosB: randomUUID(),
  };
  const orgASlug = `e2e-org-a-${suffix}`;
  const orgBSlug = `e2e-org-b-${suffix}`;
  const storeACode = `E2E-ST-A-${suffix}`;
  const storeBCode = `E2E-ST-B-${suffix}`;

  await pool.query(
    `INSERT INTO prodx_organizations (id, code, name)
     VALUES ($1, $2, 'E2E Tenant A'), ($3, $4, 'E2E Tenant B')`,
    [ids.orgA, orgASlug, ids.orgB, orgBSlug],
  );
  await pool.query(
    `INSERT INTO prodx_stores (id, organization_id, code, name, business_timezone)
     VALUES ($1, $2, $3, 'E2E Store A', 'Asia/Bangkok'),
            ($4, $5, $6, 'E2E Store B', 'Asia/Bangkok')`,
    [ids.storeA, ids.orgA, storeACode, ids.storeB, ids.orgB, storeBCode],
  );
  await pool.query(
    `INSERT INTO prodx_users (id, organization_id, username, display_name, supabase_auth_user_id)
     VALUES ($1, $2, $3, 'E2E Owner A', $4),
            ($5, $2, $6, 'E2E Cashier A', $7),
            ($8, $9, $10, 'E2E User B', $11)`,
    [
      ids.ownerA, ids.orgA, `owner-a-${suffix}@example.test`, ids.supabaseOwnerA,
      ids.cashierA, `cashier-a-${suffix}@example.test`, ids.supabaseCashierA,
      ids.userB, ids.orgB, `user-b-${suffix}@example.test`, ids.supabaseUserB,
    ],
  );
  await pool.query(
    `INSERT INTO prodx_store_memberships (organization_id, store_id, user_id)
     VALUES ($1, $2, $3), ($1, $2, $4), ($5, $6, $7)`,
    [ids.orgA, ids.storeA, ids.ownerA, ids.cashierA, ids.orgB, ids.storeB, ids.userB],
  );
  await pool.query(
    `INSERT INTO prodx_devices (id, organization_id, store_id, device_key, name)
     VALUES ($1, $2, $3, 'ADMIN-CONSOLE', 'Admin Console'),
            ($4, $2, $3, 'REG-01', 'POS Register 01'),
            ($5, $6, $7, 'REG-B1', 'Tenant B Register 01')`,
    [ids.deviceAdminA, ids.orgA, ids.storeA, ids.devicePosA, ids.devicePosB, ids.orgB, ids.storeB],
  );
  await pool.query(
    `INSERT INTO prodx_roles (id, organization_id, role_key, name)
     VALUES ($1, $2, 'owner', 'Owner'), ($3, $2, 'cashier', 'Cashier')`,
    [ids.roleOwnerA, ids.orgA, ids.roleCashierA],
  );
  await pool.query(
    `INSERT INTO prodx_user_roles (organization_id, store_id, user_id, role_id)
     VALUES ($1, $2, $3, $4), ($1, $2, $5, $6)`,
    [ids.orgA, ids.storeA, ids.ownerA, ids.roleOwnerA, ids.cashierA, ids.roleCashierA],
  );
  // Assign owner permissions (including settings.manage + pos.discount) and cashier permissions (pos.sell + pos.discount only).
  await pool.query(
    `INSERT INTO prodx_role_permissions (organization_id, role_id, permission_id)
     SELECT $1, $2, id FROM prodx_permissions
      WHERE permission_key IN ('pos.sell', 'pos.discount', 'settings.manage', 'rbac.manage', 'audit.read')`,
    [ids.orgA, ids.roleOwnerA],
  );
  await pool.query(
    `INSERT INTO prodx_role_permissions (organization_id, role_id, permission_id)
     SELECT $1, $2, id FROM prodx_permissions
      WHERE permission_key IN ('pos.sell', 'pos.discount')`,
    [ids.orgA, ids.roleCashierA],
  );
  // Set distinct store discount policies for Tenant A and Tenant B (store insert auto-provisions defaults).
  await pool.query(
    `INSERT INTO prodx_discount_policies (organization_id, store_id, require_supervisor_approval, max_discount_without_approval_bps, updated_by_user_id)
     VALUES ($1, $2, TRUE, 1000, $3),
            ($4, $5, FALSE, 2500, $6)
     ON CONFLICT (organization_id, store_id) DO UPDATE
       SET require_supervisor_approval = EXCLUDED.require_supervisor_approval,
           max_discount_without_approval_bps = EXCLUDED.max_discount_without_approval_bps,
           updated_by_user_id = EXCLUDED.updated_by_user_id`,
    [ids.orgA, ids.storeA, ids.ownerA, ids.orgB, ids.storeB, ids.userB],
  );

  // --- Step 1: Sign-in & Token Exchange ---
  // 1a. Untrusted / wrong-key RS256 JWT must be rejected with 401.
  const untrustedJwt = await signRs256Jwt({
    privateKey: untrustedPrivateKey,
    kid,
    issuer: jwksIssuer,
    subject: ids.supabaseOwnerA,
    expiresInSeconds: 1800,
  });
  const untrustedRes = await fetch(`${apiBaseUrl}/auth/supabase/session`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${untrustedJwt}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      organizationSlug: orgASlug,
      storeCode: storeACode,
      registerId: 'ADMIN-CONSOLE',
    }),
  });
  assert.equal(untrustedRes.status, 401, 'untrusted RS256 JWT must be rejected');

  // 1b. Genuine RS256 JWT for Owner on ADMIN-CONSOLE succeeds and creates prodx_sessions row.
  const initialOwnerJwt = await signRs256Jwt({
    privateKey,
    kid,
    issuer: jwksIssuer,
    subject: ids.supabaseOwnerA,
    expiresInSeconds: 1800, // 30 minutes
  });
  const ownerSignInRes = await fetch(`${apiBaseUrl}/auth/supabase/session`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${initialOwnerJwt}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      organizationSlug: orgASlug,
      storeCode: storeACode,
      registerId: 'ADMIN-CONSOLE',
    }),
  });
  assert.equal(ownerSignInRes.status, 200, 'genuine owner RS256 sign-in must succeed');
  assert.ok(jwksRequestCount >= 1, 'server must verify JWT against live HTTP JWKS endpoint');

  const ownerSession = await ownerSignInRes.json() as {
    token: string;
    expiresAt: string;
    organization: { id: string; slug: string };
    currentStore: { id: string; code: string };
    currentUser: { id: string; role: string; permissions: string[] };
  };
  assert.ok(ownerSession.token.length >= 32, 'must issue opaque POS bearer token');
  assert.equal(ownerSession.organization.id, ids.orgA);
  assert.equal(ownerSession.currentStore.id, ids.storeA);
  assert.equal(ownerSession.currentUser.id, ids.ownerA);
  assert.equal(ownerSession.currentUser.role, 'admin');

  const ownerSessionRow = await pool.query<{ id: string; expires_at: Date; revoked_at: Date | null }>(
    `SELECT id, expires_at, revoked_at FROM prodx_sessions WHERE token_hash = $1`,
    [hashSessionToken(ownerSession.token)],
  );
  assert.equal(ownerSessionRow.rows.length, 1, 'prodx_sessions row must be persisted');
  assert.equal(ownerSessionRow.rows[0].revoked_at, null);
  const ownerSessionId = ownerSessionRow.rows[0].id;
  const initialExpiresAtMs = ownerSessionRow.rows[0].expires_at.getTime();

  // --- Step 2: RBAC & Non-Owner / Non-Admin Denial ---
  // 2a. Unauthenticated requests are rejected with 401.
  const unauthSessionRes = await fetch(`${apiBaseUrl}/auth/session`);
  assert.equal(unauthSessionRes.status, 401, 'unauthenticated GET /auth/session must return 401');
  const unauthPolicyRes = await fetch(`${apiBaseUrl}/api/v1/security/discount-policy`);
  assert.equal(unauthPolicyRes.status, 401, 'unauthenticated protected API must return 401');

  // 2b. Cashier attempting admin console sign-in is denied with 403 ADMIN_ROLE_REQUIRED.
  const cashierJwt = await signRs256Jwt({
    privateKey,
    kid,
    issuer: jwksIssuer,
    subject: ids.supabaseCashierA,
    expiresInSeconds: 1800,
  });
  const cashierAdminAttemptRes = await fetch(`${apiBaseUrl}/auth/supabase/session`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cashierJwt}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      organizationSlug: orgASlug,
      storeCode: storeACode,
      registerId: 'ADMIN-CONSOLE',
      requireAdminRole: true,
    }),
  });
  assert.equal(cashierAdminAttemptRes.status, 403, 'non-owner/cashier must be denied ADMIN-CONSOLE sign-in');
  const cashierAdminBody = await cashierAdminAttemptRes.json() as { error: { code: string } };
  assert.equal(cashierAdminBody.error.code, 'ADMIN_ROLE_REQUIRED');

  // Verify any transient session created before the admin role check was revoked in PostgreSQL.
  const cashierAdminSessions = await pool.query<{ active_count: number }>(
    `SELECT COUNT(*)::int AS active_count FROM prodx_sessions
      WHERE user_id = $1 AND device_id = $2 AND revoked_at IS NULL`,
    [ids.cashierA, ids.deviceAdminA],
  );
  assert.equal(cashierAdminSessions.rows[0].active_count, 0, 'denied admin-console attempt must leave zero active sessions');

  // 2c. Cashier signs into POS register REG-01 (200), can read discount policy, but is denied PUT (403 FORBIDDEN).
  const cashierSignInRes = await fetch(`${apiBaseUrl}/auth/supabase/session`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cashierJwt}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      organizationSlug: orgASlug,
      storeCode: storeACode,
      registerId: 'REG-01',
    }),
  });
  assert.equal(cashierSignInRes.status, 200);
  const cashierSession = await cashierSignInRes.json() as { token: string; currentUser: { role: string } };
  assert.equal(cashierSession.currentUser.role, 'cashier');

  const cashierPutPolicyRes = await fetch(`${apiBaseUrl}/api/v1/security/discount-policy`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${cashierSession.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ requireSupervisorApproval: false, maxDiscountWithoutApprovalBps: 5000 }),
  });
  assert.equal(cashierPutPolicyRes.status, 403, 'cashier without settings.manage must be denied PUT discount-policy');

  // --- Step 3: Protected API (pre-renewal) & Cross-Tenant Isolation ---
  const preRenewalSessionRes = await fetch(`${apiBaseUrl}/auth/session`, {
    headers: { authorization: `Bearer ${ownerSession.token}` },
  });
  assert.equal(preRenewalSessionRes.status, 200);
  const preRenewalSessionBody = await preRenewalSessionRes.json() as { organization: { id: string }; currentStore: { id: string } };
  assert.equal(preRenewalSessionBody.organization.id, ids.orgA);
  assert.equal(preRenewalSessionBody.currentStore.id, ids.storeA);

  const preRenewalPolicyRes = await fetch(`${apiBaseUrl}/api/v1/security/discount-policy`, {
    headers: { authorization: `Bearer ${ownerSession.token}` },
  });
  assert.equal(preRenewalPolicyRes.status, 200);
  assert.deepEqual(await preRenewalPolicyRes.json(), {
    requireSupervisorApproval: true,
    maxDiscountWithoutApprovalBps: 1000,
  });

  // Owner updates Tenant A's discount policy (emits DISCOUNT_POLICY_UPDATED audit event).
  const updatePolicyRes = await fetch(`${apiBaseUrl}/api/v1/security/discount-policy`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${ownerSession.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ requireSupervisorApproval: true, maxDiscountWithoutApprovalBps: 1500 }),
  });
  assert.equal(updatePolicyRes.status, 200);
  assert.deepEqual(await updatePolicyRes.json(), {
    requireSupervisorApproval: true,
    maxDiscountWithoutApprovalBps: 1500,
  });

  // Cross-tenant isolation: Tenant A owner cannot list Tenant B stores or sign into Tenant B device,
  // and Tenant B's discount policy must remain untouched.
  const crossTenantStoresRes = await fetch(`${apiBaseUrl}/organizations/${encodeURIComponent(orgBSlug)}/stores`, {
    headers: { authorization: `Bearer ${ownerSession.token}` },
  });
  assert.equal(crossTenantStoresRes.status, 200);
  assert.deepEqual(await crossTenantStoresRes.json(), [], 'cross-tenant store listing must return empty array');

  const crossTenantSignInRes = await fetch(`${apiBaseUrl}/auth/supabase/session`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${initialOwnerJwt}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      organizationSlug: orgBSlug,
      storeCode: storeBCode,
      registerId: 'REG-B1',
    }),
  });
  assert.equal(crossTenantSignInRes.status, 401, 'cross-tenant sign-in must be rejected');

  const tenantBPolicyRow = await pool.query<{ max_discount_without_approval_bps: number }>(
    `SELECT max_discount_without_approval_bps FROM prodx_discount_policies WHERE organization_id = $1 AND store_id = $2`,
    [ids.orgB, ids.storeB],
  );
  assert.equal(Number(tenantBPolicyRow.rows[0].max_discount_without_approval_bps), 2500, 'Tenant B policy must remain isolated');

  // --- Step 4: Session Renewal (POST /auth/supabase/renew) ---
  // 4a. Cross-user renewal attempt (Owner POS bearer + Cashier Supabase JWT) must fail with 401.
  const crossUserRenewRes = await fetch(`${apiBaseUrl}/auth/supabase/renew`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ownerSession.token}`,
      'x-supabase-authorization': `Bearer ${cashierJwt}`,
    },
  });
  assert.equal(crossUserRenewRes.status, 401, 'mismatched Supabase subject must not renew another user session');

  // 4b. Genuine renewal with fresh longer-lived RS256 JWT extends expires_at monotonically.
  const refreshedOwnerJwt = await signRs256Jwt({
    privateKey,
    kid,
    issuer: jwksIssuer,
    subject: ids.supabaseOwnerA,
    expiresInSeconds: 7200, // 2 hours
  });
  const renewRes = await fetch(`${apiBaseUrl}/auth/supabase/renew`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ownerSession.token}`,
      'x-supabase-authorization': `Bearer ${refreshedOwnerJwt}`,
    },
  });
  assert.equal(renewRes.status, 200, 'valid session renewal must succeed');
  assert.equal(renewRes.headers.get('cache-control'), 'private, no-store');
  const renewedContext = await renewRes.json() as { token: string; expiresAt: string; currentUser: { id: string } };
  assert.equal(renewedContext.token, ownerSession.token, 'renewal must keep the existing opaque POS bearer stable');
  assert.equal(renewedContext.currentUser.id, ids.ownerA);
  const renewedExpiresAtMs = Date.parse(renewedContext.expiresAt);
  assert.ok(renewedExpiresAtMs > initialExpiresAtMs, 'renewal must monotonically extend session expires_at');

  const dbRenewedRow = await pool.query<{ expires_at: Date }>(
    `SELECT expires_at FROM prodx_sessions WHERE id = $1`,
    [ownerSessionId],
  );
  assert.equal(dbRenewedRow.rows[0].expires_at.getTime(), renewedExpiresAtMs);

  // --- Step 5: Protected API (post-renewal) ---
  const postRenewalSessionRes = await fetch(`${apiBaseUrl}/auth/session`, {
    headers: { authorization: `Bearer ${ownerSession.token}` },
  });
  assert.equal(postRenewalSessionRes.status, 200);
  const postRenewalSessionBody = await postRenewalSessionRes.json() as { expiresAt: string };
  assert.equal(Date.parse(postRenewalSessionBody.expiresAt), renewedExpiresAtMs);

  const postRenewalPolicyRes = await fetch(`${apiBaseUrl}/api/v1/security/discount-policy`, {
    headers: { authorization: `Bearer ${ownerSession.token}` },
  });
  assert.equal(postRenewalPolicyRes.status, 200);
  assert.deepEqual(await postRenewalPolicyRes.json(), {
    requireSupervisorApproval: true,
    maxDiscountWithoutApprovalBps: 1500,
  });

  // --- Step 6: Logout (POST /auth/logout) ---
  const logoutRes = await fetch(`${apiBaseUrl}/auth/logout`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ownerSession.token}` },
  });
  assert.equal(logoutRes.status, 204, 'logout must revoke active session and return 204');

  const revokedDbRow = await pool.query<{ revoked_at: Date | null }>(
    `SELECT revoked_at FROM prodx_sessions WHERE id = $1`,
    [ownerSessionId],
  );
  assert.ok(revokedDbRow.rows[0].revoked_at !== null, 'prodx_sessions.revoked_at must be populated after logout');

  // Replaying logout with an already-revoked token returns 401.
  const replayLogoutRes = await fetch(`${apiBaseUrl}/auth/logout`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ownerSession.token}` },
  });
  assert.equal(replayLogoutRes.status, 401, 'replayed logout on revoked session must return 401');

  // --- Step 7: Revocation Enforcement ---
  const revokedSessionRes = await fetch(`${apiBaseUrl}/auth/session`, {
    headers: { authorization: `Bearer ${ownerSession.token}` },
  });
  assert.equal(revokedSessionRes.status, 401, 'revoked token must be rejected by GET /auth/session');

  const revokedGetPolicyRes = await fetch(`${apiBaseUrl}/api/v1/security/discount-policy`, {
    headers: { authorization: `Bearer ${ownerSession.token}` },
  });
  assert.equal(revokedGetPolicyRes.status, 401, 'revoked token must be rejected by protected GET API');

  const revokedPutPolicyRes = await fetch(`${apiBaseUrl}/api/v1/security/discount-policy`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${ownerSession.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ requireSupervisorApproval: false, maxDiscountWithoutApprovalBps: 0 }),
  });
  assert.equal(revokedPutPolicyRes.status, 401, 'revoked token must be rejected by protected PUT API');

  const freshPostLogoutJwt = await signRs256Jwt({
    privateKey,
    kid,
    issuer: jwksIssuer,
    subject: ids.supabaseOwnerA,
    expiresInSeconds: 10800,
  });
  const revokedRenewRes = await fetch(`${apiBaseUrl}/auth/supabase/renew`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ownerSession.token}`,
      'x-supabase-authorization': `Bearer ${freshPostLogoutJwt}`,
    },
  });
  assert.equal(revokedRenewRes.status, 401, 'revoked token must NEVER be revived by POST /auth/supabase/renew');

  // --- Step 8: Audit Persistence Verification ---
  const auditEvents = await pool.query<{
    event_type: string;
    user_id: string | null;
    metadata: Record<string, unknown>;
  }>(
    `SELECT event_type, user_id, metadata
       FROM prodx_security_audit_events
      WHERE organization_id = $1
      ORDER BY occurred_at ASC`,
    [ids.orgA],
  );
  const renewedAudits = auditEvents.rows.filter((row) => row.event_type === 'POS_SESSION_RENEWED');
  assert.equal(renewedAudits.length, 1, 'exactly one POS_SESSION_RENEWED audit event must exist (rejected renewals must not log)');
  assert.equal(renewedAudits[0].user_id, ids.ownerA);
  assert.equal(renewedAudits[0].metadata.session_id, ownerSessionId);
  assert.equal(Date.parse(String(renewedAudits[0].metadata.expires_at)), renewedExpiresAtMs);

  const policyAudits = auditEvents.rows.filter((row) => row.event_type === 'DISCOUNT_POLICY_UPDATED');
  assert.equal(policyAudits.length, 1, 'DISCOUNT_POLICY_UPDATED audit event must be durably persisted');
  assert.equal(policyAudits[0].user_id, ids.ownerA);
  assert.equal(policyAudits[0].metadata.storeId, ids.storeA);
  assert.equal(policyAudits[0].metadata.maxDiscountWithoutApprovalBps, 1500);
});
