import assert from 'node:assert/strict';
import test from 'node:test';
import React, { type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  InternalCrashBoundary,
  sanitizeAndRestoreAppState,
} from './GlobalErrorRecoveryProvider';
import fs from 'node:fs';
import path from 'node:path';

class MockStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  getAllKeys(): string[] {
    return Array.from(this.store.keys());
  }
}

test('InternalCrashBoundary: getDerivedStateFromError catches error and transitions state', () => {
  const sampleError = new Error('Sensitive database query failed at column 4');
  const state = InternalCrashBoundary.getDerivedStateFromError(sampleError);

  assert.equal(state.hasError, true, 'Boundary state must mark hasError as true');
  assert.equal(state.error, sampleError, 'Boundary state must retain the caught error reference');
});

test('InternalCrashBoundary: render returns children when no error has occurred', () => {
  const childElement = React.createElement('div', { id: 'child-subtree' }, 'Normal content');
  const boundary = new InternalCrashBoundary({
    children: childElement,
    onCatch: () => {},
  });

  boundary.state = { hasError: false, error: null };
  const rendered = boundary.render();

  assert.equal(rendered, childElement, 'Healthy subtree must be returned directly');
});

test('InternalCrashBoundary: render displays accessible, secure fallback without leaking error details', () => {
  const boundary = new InternalCrashBoundary({
    children: React.createElement('div', null, 'Broken child'),
    onCatch: () => {},
  });

  const sensitiveError = new Error('CRITICAL_POSTGRES_AUTH_FAILURE: secret_token_xyz');
  boundary.state = { hasError: true, error: sensitiveError };

  const rendered = boundary.render() as ReactElement;
  assert.ok(rendered, 'Fallback must render a ReactElement');
  assert.equal(rendered.type, 'main', 'Fallback root should be an accessible main element');
  const props = rendered.props as Record<string, unknown>;
  assert.equal(props.id, 'global-crash-boundary-fallback');
  assert.equal(props.role, 'alert');
  assert.equal(props['aria-live'], 'assertive');

  // Verify generic user message does not expose raw error string
  const renderedString = JSON.stringify(rendered);
  assert.ok(
    !renderedString.includes('CRITICAL_POSTGRES_AUTH_FAILURE'),
    'Raw error details and secrets must not be rendered into user-facing fallback'
  );
  assert.ok(
    renderedString.includes('Reload application'),
    'Fallback must offer an explicit reload recovery action'
  );
  assert.ok(
    renderedString.includes('Your stored transaction data has not been cleared'),
    'Fallback must reassure user that local transaction data is preserved'
  );
});

test('InternalCrashBoundary: React runtime test proves fallback rendering markup and zero secret leakage', () => {
  const secretKey = 'sk-prod-pg-secret-token-do-not-leak';
  const internalDbHost = 'postgres://db_admin:superSecret@10.0.1.44:5432/prodx_production';

  const boundary = new InternalCrashBoundary({
    children: React.createElement('div', null, 'Normal child'),
    onCatch: () => {},
  });

  // Transition state to simulate caught error
  boundary.state = {
    hasError: true,
    error: new Error(`Database connection failed: ${internalDbHost} with auth ${secretKey}`),
  };

  const markup = renderToStaticMarkup(boundary.render() as ReactElement);

  // Assert expected fallback structure is present
  assert.ok(markup.includes('id="global-crash-boundary-fallback"'), 'Fallback markup must have expected element id');
  assert.ok(markup.includes('role="alert"'), 'Fallback markup must have role alert');
  assert.ok(markup.includes('PRODX POS encountered a runtime error'), 'Fallback markup must display user headline');
  assert.ok(markup.includes('Reload application'), 'Fallback markup must include reload button');
  assert.ok(markup.includes('Your stored transaction data has not been cleared'), 'Fallback markup must reassure cashier');

  // Assert secrets and internals are strictly excluded from DOM
  assert.ok(!markup.includes(secretKey), 'Secret token must never appear in rendered fallback HTML');
  assert.ok(!markup.includes(internalDbHost), 'Internal database host credentials must never appear in fallback HTML');
  assert.ok(!markup.includes('10.0.1.44'), 'Internal IP address must never appear in fallback HTML');
});

test('InternalCrashBoundary: componentDidCatch invokes onCatch callback for auditing', () => {
  let reportedError: Error | null = null;
  let reportedInfo: React.ErrorInfo | null = null;

  const boundary = new InternalCrashBoundary({
    children: React.createElement('div'),
    onCatch: (err, info) => {
      reportedError = err;
      reportedInfo = info;
    },
  });

  const testError = new Error('Render crash in POS grid');
  const testInfo: React.ErrorInfo = { componentStack: '\n    in FailingComponent' };
  boundary.componentDidCatch(testError, testInfo);

  assert.equal(reportedError, testError);
  assert.equal(reportedInfo, testInfo);
});

test('sanitizeAndRestoreAppState: unparseable corrupted JSON in outbox is NEVER deleted or overwritten with []', () => {
  const storage = new MockStorage();
  const corruptedPayload = '{"corrupted": true, broken_json: [incomplete';
  storage.setItem('prodx_pos_outbox', corruptedPayload);

  const result = sanitizeAndRestoreAppState('outbox', storage);

  // 1. Must report failure (truthful recovery status)
  assert.equal(result.success, false, 'Recovery must return success=false when outbox JSON is unparseable');
  assert.match(result.message, /unparseable corrupted JSON/i, 'Message must describe unparseable outbox corruption');

  // 2. Original outbox MUST NOT be deleted or overwritten with "[]"
  const outboxAfter = storage.getItem('prodx_pos_outbox');
  assert.equal(outboxAfter, corruptedPayload, 'Original outbox must remain intact to prevent transaction loss');
  assert.notEqual(outboxAfter, '[]', 'Outbox must NOT be wiped to [] on parse error');

  // 3. A quarantine copy must have been created
  assert.ok(result.quarantinedKeys && result.quarantinedKeys.length > 0, 'Must record quarantined key');
  const quarantineKey = result.quarantinedKeys![0];
  assert.ok(quarantineKey.startsWith('prodx_pos_outbox_quarantine_'), 'Quarantine key must have expected prefix');
  assert.equal(storage.getItem(quarantineKey), corruptedPayload, 'Quarantine storage must contain original payload');
});

test('sanitizeAndRestoreAppState: malformed non-array outbox is quarantined and returns recovery failure', () => {
  const storage = new MockStorage();
  const malformedPayload = JSON.stringify({ notAnArray: true, someField: 'bogus' });
  storage.setItem('prodx_pos_outbox', malformedPayload);

  const result = sanitizeAndRestoreAppState('outbox', storage);

  assert.equal(result.success, false, 'Recovery must return success=false for non-array outbox');
  assert.match(result.message, /not a valid queue array/i);

  // Original must not be destroyed without quarantine
  assert.ok(result.quarantinedKeys && result.quarantinedKeys.length > 0);
  const quarantineKey = result.quarantinedKeys![0];
  assert.equal(storage.getItem(quarantineKey), malformedPayload);
});

test('sanitizeAndRestoreAppState: preserves valid pending transactions and quarantines only corrupted items', () => {
  const storage = new MockStorage();
  const validTx1 = { id: 'tx-001', idempotencyKey: 'idem-001', payload: { amount: 1500 } };
  const validTx2 = { id: 'tx-002', idempotencyKey: 'idem-002', payload: { amount: 2500 } };
  const corruptedItem = { badDataWithoutId: true }; // missing id and idempotencyKey
  const nullItem = null;

  const rawQueue = [validTx1, corruptedItem, validTx2, nullItem];
  storage.setItem('prodx_pos_outbox', JSON.stringify(rawQueue));

  const result = sanitizeAndRestoreAppState('outbox', storage);

  assert.equal(result.success, true, 'Recovery must succeed when valid transactions are preserved');
  assert.match(result.message, /Quarantined 2 corrupted outbox queue items/);
  assert.match(result.message, /preserved 2 valid pending transactions/);

  // Outbox now holds only the 2 valid transactions
  const outboxAfter = JSON.parse(storage.getItem('prodx_pos_outbox')!);
  assert.equal(outboxAfter.length, 2, 'Valid transactions must remain in outbox');
  assert.equal(outboxAfter[0].id, 'tx-001');
  assert.equal(outboxAfter[1].id, 'tx-002');

  // Corrupted items must be in quarantine storage
  assert.ok(result.quarantinedKeys && result.quarantinedKeys.length > 0);
  const quarantined = JSON.parse(storage.getItem(result.quarantinedKeys![0])!);
  assert.equal(quarantined.length, 2, 'Quarantined array must hold the 2 invalid items');
});

test('sanitizeAndRestoreAppState: healthy pending transactions remain intact without modification', () => {
  const storage = new MockStorage();
  const validTx = [{ id: 'tx-100', idempotencyKey: 'idem-100', payload: { amount: 500 } }];
  storage.setItem('prodx_pos_outbox', JSON.stringify(validTx));

  const result = sanitizeAndRestoreAppState('outbox', storage);

  assert.equal(result.success, true);
  assert.match(result.message, /Verified 1 pending offline transactions intact/);
  assert.equal(storage.getItem('prodx_pos_outbox'), JSON.stringify(validTx));
  assert.equal(result.quarantinedKeys?.length ?? 0, 0, 'No keys should be quarantined for healthy outbox');
});

test('sanitizeAndRestoreAppState: held carts corrupted JSON is quarantined before reset', () => {
  const storage = new MockStorage();
  const corruptCarts = '{"held": [broken json';
  storage.setItem('prodx_held_carts', corruptCarts);

  const result = sanitizeAndRestoreAppState('cart', storage);

  assert.equal(result.success, true);
  assert.ok(result.quarantinedKeys && result.quarantinedKeys.length > 0);
  const qKey = result.quarantinedKeys![0];
  assert.ok(qKey.startsWith('prodx_held_carts_quarantine_'));
  assert.equal(storage.getItem(qKey), corruptCarts);
  assert.equal(storage.getItem('prodx_held_carts'), JSON.stringify([]));
});

test('App.tsx architecture: GlobalErrorRecoveryProvider is nested inside ErrorBoundary isGlobal across all modes', () => {
  const appPath = path.resolve(process.cwd(), 'src/App.tsx');
  const appSource = fs.readFileSync(appPath, 'utf8');

  // KDS Mode nesting
  assert.match(
    appSource,
    /<ErrorBoundary isGlobal moduleName="PRODX Kitchen Display System \(KDS\)">\s*<GlobalErrorRecoveryProvider>/,
    'KDS mode must nest GlobalErrorRecoveryProvider inside ErrorBoundary isGlobal'
  );

  // Receipt Validation Mode nesting
  assert.match(
    appSource,
    /<ErrorBoundary isGlobal moduleName="PRODX Receipt Validation Portal">\s*<GlobalErrorRecoveryProvider>/,
    'Receipt validation mode must nest GlobalErrorRecoveryProvider inside ErrorBoundary isGlobal'
  );

  // Customer Display Mode nesting
  assert.match(
    appSource,
    /<ErrorBoundary isGlobal moduleName="PRODX Customer-Facing Display">\s*<GlobalErrorRecoveryProvider>/,
    'Customer display mode must nest GlobalErrorRecoveryProvider inside ErrorBoundary isGlobal'
  );

  // POS Core Mode nesting
  assert.match(
    appSource,
    /<ErrorBoundary isGlobal moduleName="PRODX POS Core Engine">\s*<GlobalErrorRecoveryProvider>/,
    'POS core mode must nest GlobalErrorRecoveryProvider inside ErrorBoundary isGlobal'
  );
});
