import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionIssuer, hashSessionToken, type AuthenticationRepository, type CredentialRecord, type DeviceRecord, type SessionRecord } from './session';

const credential: CredentialRecord = {
  userId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000010',
  username: 'cashier', status: 'active', credentialType: 'password', secretHash: 'hash', failedAttempts: 0, lockedUntil: null,
};
const device: DeviceRecord = {
  id: '00000000-0000-0000-0000-000000000100', organizationId: credential.organizationId,
  storeId: '00000000-0000-0000-0000-000000000020', status: 'active',
};

const repositoryFixture = () => {
  let session: SessionRecord | null = null;
  let currentCredential = { ...credential };
  let linkedSupabaseUserId: string | null = '00000000-0000-4000-8000-000000000099';
  const calls = { failed: 0, reset: 0, touched: 0, revoked: 0, renewed: 0, lastLockedUntil: null as Date | null };
  const repository: AuthenticationRepository = {
    findCredentialByUsername: async (username, deviceId) =>
      username === currentCredential.username && deviceId === device.id
        ? currentCredential : null,
    findUserBySupabaseUserId: async (supabaseUserId, deviceId) =>
      supabaseUserId === linkedSupabaseUserId && deviceId === device.id
        ? { userId: currentCredential.userId, organizationId: currentCredential.organizationId, username: currentCredential.username, status: currentCredential.status }
        : null,
    recordFailedAttempt: async (_userId, _organizationId) => {
      calls.failed += 1;
      const next = currentCredential.failedAttempts + 1;
      const lockedUntil = next >= 5 ? new Date(clock.getTime() + 15 * 60 * 1000) : currentCredential.lockedUntil;
      currentCredential = { ...currentCredential, failedAttempts: next, lockedUntil };
      calls.lastLockedUntil = lockedUntil;
    },
    resetFailedAttempts: async () => { calls.reset += 1; currentCredential = { ...currentCredential, failedAttempts: 0, lockedUntil: null }; },
    createSession: async (input) => { session = { ...input, revokedAt: null, userStatus: 'active' }; },
    renewSession: async ({ sessionId, tokenHash, supabaseUserId, expiresAt }) => {
      calls.renewed += 1;
      if (supabaseUserId !== linkedSupabaseUserId || !session ||
          session.id !== sessionId || session.tokenHash !== tokenHash ||
          session.revokedAt || session.expiresAt <= clock) return null;
      const nextExpiry = expiresAt > session.expiresAt ? expiresAt : session.expiresAt;
      session = { ...session, expiresAt: nextExpiry };
      return nextExpiry;
    },
    findSessionByTokenHash: async (tokenHash) => session?.tokenHash === tokenHash ? session : null,
    findDevice: async (deviceId) => deviceId === device.id ? device : null,
    revokeSession: async (_sessionId, _tokenHash, at) => { calls.revoked += 1; if (session) session = { ...session, revokedAt: at }; },
    touchSession: async () => { calls.touched += 1; },
  };
  return { repository, calls, getSession: () => session, getCredential: () => currentCredential, unlinkSupabaseIdentity: () => { linkedSupabaseUserId = null; }, expireSession: () => { if (session) session = { ...session, expiresAt: new Date(clock.getTime() - 1) }; } };
};

const clock = new Date('2026-09-13T12:00:00.000Z');

test('credential authentication issues only a hashed bearer token', async () => {
  const { repository, calls, getSession } = repositoryFixture();
  const issuer = createSessionIssuer(repository, async (secret, encoded) => secret === 'good' && encoded === 'hash', () => clock, async () => ({ compromised: false, count: 0 }));
  const result = await issuer.authenticateCredentials({ username: ' cashier ', password: 'good', deviceId: device.id });
  assert.ok(result);
  assert.notEqual(result.token, getSession()?.tokenHash);
  assert.equal(getSession()?.tokenHash, hashSessionToken(result.token));
  assert.equal(calls.reset, 1);
  assert.equal(calls.failed, 0);
});

test('wrong credentials do not create sessions and record a failed attempt', async () => {
  const { repository, calls, getSession } = repositoryFixture();
  const issuer = createSessionIssuer(repository, async () => false, () => clock, async () => ({ compromised: false, count: 0 }));
  assert.equal(await issuer.authenticateCredentials({ username: 'cashier', password: 'bad', deviceId: device.id }), null);
  assert.equal(getSession(), null);
  assert.equal(calls.failed, 1);
  assert.equal(calls.lastLockedUntil, null);
});

test('five failed attempts lock the credential for fifteen minutes and lockout attempts do not increment', async () => {
  const { repository, calls, getCredential } = repositoryFixture();
  const issuer = createSessionIssuer(repository, async () => false, () => clock, async () => ({ compromised: false, count: 0 }));
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.equal(await issuer.authenticateCredentials({ username: 'cashier', password: 'bad', deviceId: device.id }), null);
  }
  assert.equal(getCredential().failedAttempts, 5);
  assert.deepEqual(calls.lastLockedUntil, new Date('2026-09-13T12:15:00.000Z'));
  assert.equal(await issuer.authenticateCredentials({ username: 'cashier', password: 'bad', deviceId: device.id }), null);
  assert.equal(calls.failed, 5);
  assert.equal(getCredential().failedAttempts, 5);
});

test('successful authentication resets failed attempts and clears lockout state', async () => {
  const { repository, getCredential } = repositoryFixture();
  const issuer = createSessionIssuer(repository, async (secret) => secret === 'good', () => clock, async () => ({ compromised: false, count: 0 }));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.equal(await issuer.authenticateCredentials({ username: 'cashier', password: 'bad', deviceId: device.id }), null);
  }
  assert.equal(getCredential().failedAttempts, 4);
  const result = await issuer.authenticateCredentials({ username: 'cashier', password: 'good', deviceId: device.id });
  assert.ok(result);
  assert.equal(getCredential().failedAttempts, 0);
  assert.equal(getCredential().lockedUntil, null);
});

test('disabled device, locked user, and cross-tenant device cannot authenticate', async () => {
  const { repository } = repositoryFixture();
  const issuer = createSessionIssuer(repository, async () => true, () => clock, async () => ({ compromised: false, count: 0 }));
  assert.equal(await issuer.authenticateCredentials({ username: 'cashier', password: 'good', deviceId: 'unknown' }), null);
  const lockedCredential = { ...credential, lockedUntil: new Date(clock.getTime() + 60_000) };
  repository.findCredentialByUsername = async () => lockedCredential;
  assert.equal(await issuer.authenticateCredentials({ username: 'cashier', password: 'good', deviceId: device.id }), null);
  repository.findCredentialByUsername = async () => credential;
  repository.findDevice = async () => ({ ...device, organizationId: '00000000-0000-0000-0000-000000000099' });
  assert.equal(await issuer.authenticateCredentials({ username: 'cashier', password: 'good', deviceId: device.id }), null);
});

test('bearer authentication rejects expired, revoked, disabled-user, and disabled-device sessions', async () => {
  const { repository, calls, getSession } = repositoryFixture();
  const issuer = createSessionIssuer(repository, async () => true, () => clock, async () => ({ compromised: false, count: 0 }));
  const result = await issuer.authenticateCredentials({ username: 'cashier', password: 'good', deviceId: device.id });
  assert.ok(result);
  assert.deepEqual(await issuer.authenticateBearer(result.token), {
    sessionId: result.sessionId, userId: credential.userId, organizationId: credential.organizationId, storeId: device.storeId,
  });
  assert.equal(calls.touched, 1);
  repository.findSessionByTokenHash = async () => ({ ...getSession()!, expiresAt: new Date(clock.getTime() - 1) });
  assert.equal(await issuer.authenticateBearer(result.token), null);
  repository.findSessionByTokenHash = async () => ({ ...getSession()!, expiresAt: new Date(clock.getTime() + 60_000), revokedAt: clock });
  assert.equal(await issuer.authenticateBearer(result.token), null);
  repository.findSessionByTokenHash = async () => ({ ...getSession()!, expiresAt: new Date(clock.getTime() + 60_000), revokedAt: null, userStatus: 'disabled' });
  assert.equal(await issuer.authenticateBearer(result.token), null);
  repository.findSessionByTokenHash = async () => ({ ...getSession()!, expiresAt: new Date(clock.getTime() + 60_000), revokedAt: null });
  repository.findDevice = async () => ({ ...device, status: 'disabled' });
  assert.equal(await issuer.authenticateBearer(result.token), null);
});

test('revokeBearer revokes an active session once and rejects unknown tokens', async () => {
  const { repository, calls } = repositoryFixture();
  const issuer = createSessionIssuer(repository, async () => true, () => clock, async () => ({ compromised: false, count: 0 }));
  const result = await issuer.authenticateCredentials({ username: 'cashier', password: 'good', deviceId: device.id });
  assert.ok(result);
  assert.ok(result.expiresAt > clock);
  assert.equal(await issuer.revokeBearer(''), false);
  assert.equal(await issuer.revokeBearer('unknown-token'), false);
  assert.equal(await issuer.revokeBearer(result.token), true);
  assert.equal(calls.revoked, 1);
  assert.equal(await issuer.revokeBearer(result.token), false);
  assert.equal(await issuer.authenticateBearer(result.token), null);
});

test('credential lookup is scoped to the device organization', async () => {
  const { repository } = repositoryFixture();
  const issuer = createSessionIssuer(repository, async () => true, () => clock, async () => ({ compromised: false, count: 0 }));
  repository.findDevice = async () => ({ ...device, organizationId: '00000000-0000-0000-0000-000000000099' });
  assert.equal(await issuer.authenticateCredentials({ username: 'cashier', password: 'good', deviceId: device.id }), null);
});

test('rejects authentication when the credential password is compromised', async () => {
  const { repository } = repositoryFixture();
  const issuer = createSessionIssuer(
    repository,
    async () => true,
    () => new Date('2026-09-14T00:00:00.000Z'),
    async () => ({ compromised: true, count: 42 }),
  );
  assert.equal(
    await issuer.authenticateCredentials({ username: 'cashier', password: 'known-compromised', deviceId: 'device-1' }),
    null,
  );
});

test('rejects client-controlled WebAuthn marker without issuing a session', async () => {
  const { repository, calls, getSession } = repositoryFixture();
  let passwordVerifierCalled = false;
  let compromiseCheckerCalled = false;
  const issuer = createSessionIssuer(
    repository,
    async () => { passwordVerifierCalled = true; return true; },
    () => clock,
    async () => { compromiseCheckerCalled = true; return { compromised: false, count: 0 }; },
  );
  const result = await issuer.authenticateCredentials({
    username: 'cashier',
    password: 'WEBAUTHN_VERIFIED:pk_cashier_john_front_reg:chal_12345',
    deviceId: device.id,
  });
  assert.equal(result, null);
  assert.equal(getSession(), null);
  assert.equal(passwordVerifierCalled, false);
  assert.equal(compromiseCheckerCalled, false);
  assert.equal(calls.failed, 1);
  assert.equal(calls.reset, 0);
});



test('Supabase subject creates a POS session through explicit UUID mapping without a local password credential', async () => {
  const { repository, getSession } = repositoryFixture();
  repository.findCredentialByUsername = async () => null;
  const identityExpiry = new Date(clock.getTime() + 2 * 60 * 60 * 1000);
  const issuer = createSessionIssuer(
    repository,
    async () => true,
    () => clock,
    async () => ({ compromised: false, count: 0 }),
    async (token) => token === 'verified-token'
      ? { userId: '00000000-0000-4000-8000-000000000099', expiresAt: identityExpiry }
      : null,
  );
  const result = await issuer.authenticateSupabaseToken({ token: 'verified-token', deviceId: device.id });
  assert.ok(result);
  assert.equal(result.expiresAt.getTime(), identityExpiry.getTime());
  assert.equal(getSession()?.organizationId, credential.organizationId);
  assert.equal(getSession()?.deviceId, device.id);
  assert.equal(getSession()?.tokenHash, hashSessionToken(result.token));
});

test('Supabase subject does not fall back to email when no explicit mapping exists', async () => {
  const { repository, getSession, unlinkSupabaseIdentity } = repositoryFixture();
  unlinkSupabaseIdentity();
  const issuer = createSessionIssuer(
    repository,
    async () => true,
    () => clock,
    async () => ({ compromised: false, count: 0 }),
    async () => ({ userId: '00000000-0000-4000-8000-000000000099', expiresAt: new Date(clock.getTime() + 60_000) }),
  );
  assert.equal(await issuer.authenticateSupabaseToken({ token: 'valid-but-unlinked', deviceId: device.id }), null);
  assert.equal(getSession(), null);
});

test('Supabase renewal extends the same hashed POS bearer only after re-verifying its linked identity', async () => {
  const { repository, calls, getSession } = repositoryFixture();
  const refreshedExpiry = new Date(clock.getTime() + 2 * 60 * 60 * 1000);
  const issuer = createSessionIssuer(
    repository,
    async () => true,
    () => clock,
    async () => ({ compromised: false, count: 0 }),
    async (token) => token === 'initial-supabase-token'
      ? { userId: '00000000-0000-4000-8000-000000000099', expiresAt: new Date(clock.getTime() + 15 * 60 * 1000) }
      : token === 'fresh-supabase-token'
        ? { userId: '00000000-0000-4000-8000-000000000099', expiresAt: refreshedExpiry }
        : null,
  );
  const original = await issuer.authenticateSupabaseToken({ token: 'initial-supabase-token', deviceId: device.id });
  assert.ok(original);
  const renewed = await issuer.renewSupabaseSession({ supabaseToken: 'fresh-supabase-token', posToken: original.token });
  assert.ok(renewed);
  assert.equal(renewed.expiresAt.getTime(), refreshedExpiry.getTime());
  assert.equal(getSession()?.id, original.sessionId);
  assert.equal(getSession()?.tokenHash, hashSessionToken(original.token));
  assert.ok(await issuer.authenticateBearer(original.token), 'the existing POS bearer remains valid');
  assert.equal(calls.renewed, 1);
});

test('Supabase renewal rejects invalid, unlinked, expired, and revoked sessions without writing', async () => {
  const { repository, calls, unlinkSupabaseIdentity, expireSession } = repositoryFixture();
  const refreshedExpiry = new Date(clock.getTime() + 60 * 60 * 1000);
  const issuer = createSessionIssuer(
    repository,
    async () => true,
    () => clock,
    async () => ({ compromised: false, count: 0 }),
    async (token) => token === 'initial'
      ? { userId: '00000000-0000-4000-8000-000000000099', expiresAt: new Date(clock.getTime() + 15 * 60 * 1000) }
      : token === 'wrong-subject'
        ? { userId: '00000000-0000-4000-8000-000000000098', expiresAt: refreshedExpiry }
        : token === 'fresh'
          ? { userId: '00000000-0000-4000-8000-000000000099', expiresAt: refreshedExpiry }
          : null,
  );
  const original = await issuer.authenticateSupabaseToken({ token: 'initial', deviceId: device.id });
  assert.ok(original);
  assert.equal(await issuer.renewSupabaseSession({ supabaseToken: 'invalid', posToken: original.token }), null);
  assert.equal(await issuer.renewSupabaseSession({ supabaseToken: 'wrong-subject', posToken: original.token }), null);
  unlinkSupabaseIdentity();
  assert.equal(await issuer.renewSupabaseSession({ supabaseToken: 'fresh', posToken: original.token }), null);
  assert.equal(calls.renewed, 0);

  const { repository: expiredRepository, calls: expiredCalls, expireSession: expire } = repositoryFixture();
  const expiredIssuer = createSessionIssuer(
    expiredRepository, async () => true, () => clock,
    async () => ({ compromised: false, count: 0 }),
    async (token) => token === 'initial'
      ? { userId: '00000000-0000-4000-8000-000000000099', expiresAt: new Date(clock.getTime() + 15 * 60 * 1000) }
      : { userId: '00000000-0000-4000-8000-000000000099', expiresAt: refreshedExpiry },
  );
  const expiring = await expiredIssuer.authenticateSupabaseToken({ token: 'initial', deviceId: device.id });
  assert.ok(expiring);
  expire();
  assert.equal(await expiredIssuer.renewSupabaseSession({ supabaseToken: 'fresh', posToken: expiring.token }), null);
  assert.equal(expiredCalls.renewed, 0);

  const { repository: revokedRepository, calls: revokedCalls } = repositoryFixture();
  const revokedIssuer = createSessionIssuer(
    revokedRepository, async () => true, () => clock,
    async () => ({ compromised: false, count: 0 }),
    async (token) => token === 'initial'
      ? { userId: '00000000-0000-4000-8000-000000000099', expiresAt: new Date(clock.getTime() + 15 * 60 * 1000) }
      : { userId: '00000000-0000-4000-8000-000000000099', expiresAt: refreshedExpiry },
  );
  const revoked = await revokedIssuer.authenticateSupabaseToken({ token: 'initial', deviceId: device.id });
  assert.ok(revoked);
  assert.equal(await revokedIssuer.revokeBearer(revoked.token), true);
  assert.equal(await revokedIssuer.renewSupabaseSession({ supabaseToken: 'fresh', posToken: revoked.token }), null);
  assert.equal(revokedCalls.renewed, 0);
});
