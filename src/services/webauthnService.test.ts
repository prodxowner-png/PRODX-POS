import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authenticatePasskey,
  getRegisteredPasskeys,
  registerPasskey,
  resetPasskeys,
  revokeEnrolledPasskey,
  saveRegisteredPasskeys,
} from './webauthnService';

test('passkey enrollment remains unavailable until server-side verification exists', async () => {
  const result = await registerPasskey({
    id: 'user-1',
    email: 'admin@example.invalid',
    name: 'Admin',
    role: 'admin',
  });

  assert.equal(result.success, false);
  assert.equal(result.credential, undefined);
  assert.equal(result.isVirtual, false);
  assert.match(result.error ?? '', /server-side WebAuthn verification/i);
});

test('passkey authentication cannot produce a client-authoritative assertion', async () => {
  const result = await authenticatePasskey(
    { id: 'user-1', email: 'admin@example.invalid', name: 'Admin' },
  );

  assert.equal(result.success, false);
  assert.equal(result.credential, undefined);
  assert.equal(result.assertion, undefined);
  assert.match(result.error ?? '', /server-side WebAuthn verification/i);
});

test('browser-side passkey registry cannot create trusted credentials', () => {
  saveRegisteredPasskeys([{
    id: 'forged-credential',
    userId: 'user-1',
    userEmail: 'admin@example.invalid',
    userName: 'Admin',
    userRole: 'admin',
    deviceLabel: 'Forged',
    authenticatorType: 'virtual_biometric',
    createdAt: new Date(0).toISOString(),
    counter: 999,
    isVirtualFallback: true,
  }]);

  assert.deepEqual(getRegisteredPasskeys(), []);
  assert.deepEqual(resetPasskeys(), []);
  assert.deepEqual(revokeEnrolledPasskey('forged-credential'), { remaining: [] });
});
