import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionIssuer, type AuthenticationRepository, type CredentialRecord, type DeviceRecord } from './session';

const organizationId = '00000000-0000-0000-0000-000000000010';
const credential: CredentialRecord = {
  userId: '00000000-0000-0000-0000-000000000001', organizationId, username: 'cashier',
  status: 'active', credentialType: 'password', secretHash: 'hash', failedAttempts: 0, lockedUntil: null,
};
const device: DeviceRecord = {
  id: '00000000-0000-0000-0000-000000000100', organizationId,
  storeId: '00000000-0000-0000-0000-000000000020', status: 'active',
};

test('approved policy: fifth failure locks for 15 minutes and active-lockout attempts do not mutate state', async () => {
  let current = { ...credential };
  const repository: AuthenticationRepository = {
    findCredentialByUsername: async () => current,
    findUserBySupabaseUserId: async () => null,
    recordFailedAttempt: async (_userId) => {
      const failedAttempts = Math.min(current.failedAttempts + 1, 5);
      current = { ...current, failedAttempts, lockedUntil: failedAttempts >= 5 ? new Date(now.getTime() + 15 * 60 * 1000) : current.lockedUntil };
    },
    resetFailedAttempts: async () => { current = { ...current, failedAttempts: 0, lockedUntil: null }; },
    createSession: async () => {},
    findSessionByTokenHash: async () => null,
    findDevice: async () => device,
    revokeSession: async () => {},
    touchSession: async () => {},
  };
  const now = new Date('2026-09-14T00:00:00.000Z');
  const issuer = createSessionIssuer(repository, async () => false, () => now, async () => ({ compromised: false, count: 0 }));

  for (let i = 0; i < 5; i += 1) {
    assert.equal(await issuer.authenticateCredentials({ username: 'cashier', password: 'bad', deviceId: device.id }), null);
  }
  assert.equal(current.failedAttempts, 5);
  assert.equal(current.lockedUntil?.toISOString(), '2026-09-14T00:15:00.000Z');

  assert.equal(await issuer.authenticateCredentials({ username: 'cashier', password: 'bad', deviceId: device.id }), null);
  assert.equal(current.failedAttempts, 5);
  assert.equal(current.lockedUntil?.toISOString(), '2026-09-14T00:15:00.000Z');
});
