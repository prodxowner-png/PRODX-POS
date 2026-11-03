import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchSystemOwnerCredentialStatusFromDatabase,
  resetSystemOwnerAdminPasswordInDatabase,
  verifySystemOwnerReauthentication,
} from '../../src/services/adminCredentialService.ts';
import { SYSTEM_OWNER_ADMIN_EMAIL, SYSTEM_OWNER_ADMIN_ID } from '../../src/domain/auth.ts';

test('admin credential status does not expose browser or Firestore credential records', async () => {
  const status = await fetchSystemOwnerCredentialStatusFromDatabase();
  assert.equal(status.id, SYSTEM_OWNER_ADMIN_ID);
  assert.equal(status.email, SYSTEM_OWNER_ADMIN_EMAIL);
  assert.equal(status.source, 'disabled');
  assert.equal(status.passwordHash, '');
  assert.equal(status.passwordSalt, '');
});

test('client password and biometric flags cannot authorize administrator reauthentication', async () => {
  const result = await verifySystemOwnerReauthentication({
    user: { id: SYSTEM_OWNER_ADMIN_ID, email: SYSTEM_OWNER_ADMIN_EMAIL, role: 'admin' } as never,
    currentPassword: 'a plausible password',
    biometricVerified: true,
  });
  assert.equal(result.verified, false);
  assert.match(result.error ?? '', /server-side PostgreSQL/i);
});

test('admin reset fails closed without claiming success or returning credential material', async () => {
  const result = await resetSystemOwnerAdminPasswordInDatabase({
    actor: { id: SYSTEM_OWNER_ADMIN_ID, email: SYSTEM_OWNER_ADMIN_EMAIL, role: 'admin' } as never,
    currentPassword: 'current password',
    newPassword: 'Strong!Pass123',
  });
  assert.equal(result.success, false);
  assert.equal(result.passwordHash, undefined);
  assert.equal(result.passwordSalt, undefined);
  assert.equal(result.syncedToFirestore, undefined);
  assert.match(result.error ?? '', /disabled/i);
});
