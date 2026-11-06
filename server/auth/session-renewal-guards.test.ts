import assert from 'node:assert/strict';
import test from 'node:test';
import { isProductionApiBaseUrl } from '../../src/adapters/apiBaseUrl';
import { isCurrentSessionRenewal } from '../../src/context/sessionRenewalGuard';

test('production auth accepts root-relative same-origin API bases', () => {
  assert.equal(isProductionApiBaseUrl('/'), true);
  assert.equal(isProductionApiBaseUrl('/api'), true);
  assert.equal(isProductionApiBaseUrl('  /api/v1  '), true);
});

test('production auth rejects missing, protocol-relative, and non-root-relative bases', () => {
  assert.equal(isProductionApiBaseUrl(''), false);
  assert.equal(isProductionApiBaseUrl('   '), false);
  assert.equal(isProductionApiBaseUrl('//untrusted.example/api'), false);
  assert.equal(isProductionApiBaseUrl('api/v1'), false);
});

test('session renewal guard accepts only the active, undisposed bearer', () => {
  assert.equal(isCurrentSessionRenewal(false, 'pos-token-a', 'pos-token-a'), true);
  assert.equal(isCurrentSessionRenewal(true, 'pos-token-a', 'pos-token-a'), false);
  assert.equal(isCurrentSessionRenewal(false, 'pos-token-b', 'pos-token-a'), false);
  assert.equal(isCurrentSessionRenewal(false, null, 'pos-token-a'), false);
});
