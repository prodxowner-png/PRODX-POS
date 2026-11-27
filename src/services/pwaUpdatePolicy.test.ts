import assert from 'node:assert/strict';
import test from 'node:test';
import { canApplyPwaUpdate, getPwaUpdateBlockers, type PwaUpdateSafetyState } from './pwaUpdatePolicy';

const safeState: PwaUpdateSafetyState = {
  isOnline: true,
  isOutboxReady: true,
  isSyncing: false,
  hasUnresolvedOutbox: false,
  isShiftLoading: false,
  isShiftStateKnown: true,
  hasActiveShift: false,
  hasInventoryMutationInFlight: false,
};

test('PWA update is allowed only when all safety gates are clear', () => {
  assert.equal(canApplyPwaUpdate(safeState), true);
  assert.deepEqual(getPwaUpdateBlockers(safeState), []);
});

test('offline, uninitialized outbox, and active sync each block updates', () => {
  assert.deepEqual(getPwaUpdateBlockers({ ...safeState, isOnline: false }), ['offline']);
  assert.deepEqual(getPwaUpdateBlockers({ ...safeState, isOutboxReady: false }), ['outbox-loading']);
  assert.deepEqual(getPwaUpdateBlockers({ ...safeState, isSyncing: true }), ['syncing']);
});

test('every unresolved outbox state blocks updates, including failed and conflict items', () => {
  assert.deepEqual(getPwaUpdateBlockers({ ...safeState, hasUnresolvedOutbox: true }), ['outbox-unresolved']);
});

test('unknown or loading shift state fails closed instead of assuming the shift is closed', () => {
  assert.deepEqual(getPwaUpdateBlockers({ ...safeState, isShiftLoading: true }), ['shift-loading']);
  assert.deepEqual(getPwaUpdateBlockers({ ...safeState, isShiftStateKnown: false }), ['shift-unknown']);
});

test('an active shift blocks updates even when all other gates are clear', () => {
  assert.deepEqual(getPwaUpdateBlockers({ ...safeState, hasActiveShift: true }), ['active-shift']);
});

test('multiple unsafe states report every blocker in deterministic order', () => {
  assert.deepEqual(
    getPwaUpdateBlockers({
      ...safeState,
      isOnline: false,
      isOutboxReady: false,
      isSyncing: true,
      hasUnresolvedOutbox: true,
      isShiftLoading: true,
      isShiftStateKnown: false,
      hasActiveShift: true,
      hasInventoryMutationInFlight: true,
    }),
    ['offline', 'outbox-loading', 'syncing', 'outbox-unresolved', 'shift-loading', 'shift-unknown', 'active-shift', 'inventory-mutation'],
  );
  assert.equal(canApplyPwaUpdate({ ...safeState, hasActiveShift: true }), false);
});

test('an in-flight inventory mutation blocks PWA activation', () => {
  assert.deepEqual(
    getPwaUpdateBlockers({ ...safeState, hasInventoryMutationInFlight: true }),
    ['inventory-mutation'],
  );
  assert.equal(canApplyPwaUpdate({ ...safeState, hasInventoryMutationInFlight: true }), false);
});
