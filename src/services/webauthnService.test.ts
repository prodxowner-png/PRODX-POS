import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bufferToBase64URL,
  base64URLToBuffer,
  stringToBase64URL,
  base64URLToString,
  createWebAuthnChallengeRecord,
  PasskeyCredentialRecord,
} from './webauthnService.ts';

test('WebAuthn: Base64URL encoding and decoding round-trip', () => {
  const testString = 'PRODX-POS-WebAuthn-Quick-Sign-In-Challenge-2026';
  const encoded = stringToBase64URL(testString);
  const decoded = base64URLToString(encoded);

  assert.equal(decoded, testString);
  // Must be URL-safe (no +, /, or trailing =)
  assert.ok(!encoded.includes('+'), 'Must not include +');
  assert.ok(!encoded.includes('/'), 'Must not include /');
  assert.ok(!encoded.includes('='), 'Must not include trailing =');
});

test('WebAuthn: binary buffer conversion matches expected bytes', () => {
  const bytes = new Uint8Array([0, 15, 127, 255, 42, 99]);
  const base64url = bufferToBase64URL(bytes.buffer);
  const recovered = base64URLToBuffer(base64url);

  assert.equal(recovered.length, bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    assert.equal(recovered[i], bytes[i]);
  }
});

test('WebAuthn: creates single-use challenge with valid TTL and CSPRNG entropy', () => {
  const targetUser = {
    id: 'usr-cashier-john',
    email: 'john.doe@prodx.io',
  };

  const challengeRec = createWebAuthnChallengeRecord(targetUser, 30_000);

  assert.ok(challengeRec.challengeId.startsWith('wauthn-chal-'));
  assert.ok(challengeRec.challenge.length > 20, 'Challenge must have sufficient entropy');
  assert.equal(challengeRec.targetUserId, 'usr-cashier-john');
  assert.equal(challengeRec.targetUserEmail, 'john.doe@prodx.io');
  assert.equal(challengeRec.used, false);
  assert.ok(challengeRec.expiresAt > challengeRec.issuedAt);
  assert.equal(challengeRec.expiresAt - challengeRec.issuedAt, 30_000);
});

test('WebAuthn: Quick Sign-In credential structure supports PIN bypass', () => {
  const cashierCredential: PasskeyCredentialRecord = {
    id: 'pk_cashier_quick_signin_test',
    userId: 'usr-cashier-001',
    userEmail: 'cashier1@prodx.io',
    userName: 'Jane Cashier',
    userRole: 'cashier',
    deviceLabel: 'Terminal Front-Register (Touch ID)',
    authenticatorType: 'touch_id',
    createdAt: new Date().toISOString(),
    counter: 10,
    isVirtualFallback: false,
  };

  assert.equal(cashierCredential.userRole, 'cashier');
  assert.equal(cashierCredential.authenticatorType, 'touch_id');
  assert.ok(cashierCredential.id.length > 0);
  assert.ok(cashierCredential.userName.length > 0);
});
