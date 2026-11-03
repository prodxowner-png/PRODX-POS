import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthDiagnosticRequest } from './authDiagnostics';

test('authentication diagnostic metadata excludes password, PIN, and direct identity', () => {
  const email = 'cashier@example.test';
  const password = 'correct-horse-battery-staple';
  const metadata = createAuthDiagnosticRequest({
    organizationSlug: 'demo-org',
    storeCode: 'STORE-01',
    registerId: 'POS-01',
    emailOrPin: email,
    requireAdminRole: false,
  });
  const serialized = JSON.stringify(metadata);
  assert.equal(serialized.includes(email), false);
  assert.equal(serialized.includes(password), false);
  assert.equal(serialized.includes('passwordOrPin'), false);
  assert.equal(metadata.identityType, 'email');
  assert.equal(metadata.identityPresent, true);
});

test('authentication diagnostic metadata classifies staff identifiers without exposing them', () => {
  const staffPin = '987654';
  const metadata = createAuthDiagnosticRequest({ emailOrPin: staffPin });
  assert.equal(JSON.stringify(metadata).includes(staffPin), false);
  assert.equal(metadata.identityType, 'staff-identifier');
  assert.equal(metadata.identityPresent, true);
});
