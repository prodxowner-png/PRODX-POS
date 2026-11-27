import assert from 'node:assert/strict';
import test from 'node:test';
import { getShiftScopeKey, isShiftStateKnownForScope } from './shiftStatePolicy';

test('shift state is trusted only for the exact authenticated store, register, and user', () => {
  const scope = { storeId: 'store-a', registerId: 'register-1', userId: 'user-a' };
  const key = getShiftScopeKey(scope);

  assert.equal(key, getShiftScopeKey({ ...scope }));
  assert.equal(isShiftStateKnownForScope(key, key), true);
  assert.equal(isShiftStateKnownForScope(getShiftScopeKey({ ...scope, userId: 'user-b' }), key), false);
  assert.equal(isShiftStateKnownForScope(getShiftScopeKey({ ...scope, storeId: 'store-b' }), key), false);
  assert.equal(isShiftStateKnownForScope(getShiftScopeKey({ ...scope, registerId: 'register-2' }), key), false);
});

test('unknown authenticated shift state fails closed, while unauthenticated scope has no shift', () => {
  assert.equal(isShiftStateKnownForScope('authenticated-scope', null), false);
  assert.equal(isShiftStateKnownForScope(null, null), true);
});
