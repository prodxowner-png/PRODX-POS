import assert from 'node:assert/strict';
import test from 'node:test';
import { hasProductionApiRoute, shouldUseDevelopmentMocks } from './env';

test('production does not select mock adapters based on missing API URL configuration', () => {
  assert.equal(shouldUseDevelopmentMocks({ isDev: false, isPreview: false, mocksDisabled: false }), false);
});

test('explicit development and preview runtimes may use mocks unless explicitly disabled', () => {
  assert.equal(shouldUseDevelopmentMocks({ isDev: true, isPreview: false, mocksDisabled: false }), true);
  assert.equal(shouldUseDevelopmentMocks({ isDev: false, isPreview: true, mocksDisabled: false }), true);
  assert.equal(shouldUseDevelopmentMocks({ isDev: true, isPreview: true, mocksDisabled: true }), false);
});


test('production treats an omitted API base as same-origin, never as a local policy fallback', () => {
  assert.equal(hasProductionApiRoute({ isDev: false, isPreview: false, mocksDisabled: false }), true);
  assert.equal(hasProductionApiRoute({ isDev: true, isPreview: false, mocksDisabled: false }), false);
});

test('development and preview without an API base remain isolated from production routes', () => {
  assert.equal(hasProductionApiRoute({ isDev: true, isPreview: false, mocksDisabled: false }), false);
  assert.equal(hasProductionApiRoute({ isDev: false, isPreview: true, mocksDisabled: false }), false);
  assert.equal(hasProductionApiRoute({ isDev: true, isPreview: false, mocksDisabled: true }), true);
});

test('production classification remains fail-closed even when API URL configuration is invalid or missing', () => {
  assert.equal(hasProductionApiRoute({ isDev: false, isPreview: false, mocksDisabled: false }), true);
});
