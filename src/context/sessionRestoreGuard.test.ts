import assert from 'node:assert/strict';
import test from 'node:test';
import { canClearRestoredSession, isCurrentSessionRestore } from './sessionRestoreGuard';

test('session restore publishes only while its persisted bearer is still current', () => {
  assert.equal(isCurrentSessionRestore('old-token', 'old-token', null), true);
  assert.equal(isCurrentSessionRestore('old-token', 'old-token', 'old-token'), true);
  assert.equal(isCurrentSessionRestore('old-token', 'replacement-token', null), false);
  assert.equal(isCurrentSessionRestore('old-token', 'old-token', 'replacement-token'), false);
  assert.equal(isCurrentSessionRestore('old-token', null, null), false);
});

test('session restore cleanup never clears a replacement persisted or active session', () => {
  assert.equal(canClearRestoredSession('old-token', 'old-token', null), true);
  assert.equal(canClearRestoredSession('old-token', null, null), true);
  assert.equal(canClearRestoredSession('old-token', 'old-token', 'old-token'), true);
  assert.equal(canClearRestoredSession('old-token', 'replacement-token', null), false);
  assert.equal(canClearRestoredSession('old-token', 'old-token', 'replacement-token'), false);
  assert.equal(canClearRestoredSession('', null, null), false);
});
