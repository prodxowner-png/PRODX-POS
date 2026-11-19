import assert from 'node:assert/strict';
import test from 'node:test';
import React, { type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  getSafeRuntimeErrorName,
  GlobalErrorRecoveryProvider,
  InternalCrashBoundary,
  reloadApplicationPreservingLocalData,
  sanitizeAndRestoreAppState,
} from './GlobalErrorRecoveryProvider';
import fs from 'node:fs';
import path from 'node:path';
import { AUTH_SESSION_STORAGE_KEY } from './authSessionStorage';

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

test('ErrorBoundary source: recovery UI withholds raw exceptions and never clears browser storage', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/components/common/ErrorBoundary.tsx'), 'utf8');
  assert.match(source, /errorName/);
  assert.match(source, /message and stack withheld/);
  assert.match(source, /Reloading preserves local transaction and session data/);
  assert.doesNotMatch(source, /localStorage\.clear\s*\(/);
  assert.doesNotMatch(source, /sessionStorage\.clear\s*\(/);
  assert.doesNotMatch(source, /error\?\.message/);
  assert.doesNotMatch(source, /error\?\.stack/);
  assert.doesNotMatch(source, /error\.message/);
  assert.doesNotMatch(source, /error\.stack/);
  assert.doesNotMatch(source, /this\.props\.onError\(error, errorInfo\)/);
  assert.match(source, /const safeError = new Error/);
  assert.doesNotMatch(source, /btn-error-hard-reload-clear/);
});

test('getSafeRuntimeErrorName rejects attacker-controlled names and bounds diagnostic metadata', () => {
  assert.equal(getSafeRuntimeErrorName(new TypeError('sensitive exception')), 'TypeError');
  assert.equal(getSafeRuntimeErrorName(Object.assign(new Error('secret'), { name: 'Bearer secret-token' })), 'Error');
  assert.equal(getSafeRuntimeErrorName({ name: 'TypeError' }), null);
});

test('reloadApplicationPreservingLocalData removes only the transient query cache and preserves POS data', () => {
  const localStorage = new MockStorage();
  const sessionStorage = new MockStorage();
  const outbox = JSON.stringify([{ id: 'sale-1', idempotencyKey: 'idem-1' }]);
  const authSession = JSON.stringify({ token: 'opaque-pos-session' });
  localStorage.setItem('prodx_pos_outbox', outbox);
  localStorage.setItem('prodx_pos_session', authSession);
  sessionStorage.setItem('prodx_temp_query_cache', 'stale');
  sessionStorage.setItem('unrelated-session-state', 'keep');
  let reloadCount = 0;

  reloadApplicationPreservingLocalData(sessionStorage, () => { reloadCount += 1; });

  assert.equal(reloadCount, 1);
  assert.equal(localStorage.getItem('prodx_pos_outbox'), outbox);
  assert.equal(localStorage.getItem('prodx_pos_session'), authSession);
  assert.equal(sessionStorage.getItem('prodx_temp_query_cache'), null);
  assert.equal(sessionStorage.getItem('unrelated-session-state'), 'keep');
});

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

test('GlobalErrorRecoveryProvider: mounted production boundary catches descendant crashes and audits only redacted metadata', async () => {
  const secretToken = 'sk-super-secret-postgres-auth-token-12345';
  const originalConsoleError = console.error;
  const globalKeys = ['window', 'document', 'HTMLIFrameElement', 'HTMLElement', 'localStorage', 'sessionStorage', 'location', 'fetch', 'addEventListener', 'removeEventListener'];
  const originalDescriptors = new Map(globalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const localStore = new MockStorage();
  const sessionStore = new MockStorage();
  localStore.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify({ token: 'test-pos-session-token' }));

  let auditPayload: Record<string, any> | null = null;
  let auditAuthorization = '';

  class DummyElement {
    nodeType = 1;
    tagName = 'DIV';
    style = { setProperty() {}, removeProperty() {} };
    children: any[] = [];
    props: Record<string, any> = {};
    parentNode: any = null;
    ownerDocument: any = null;
    private ownText = '';

    appendChild(child: any) { this.children.push(child); child.parentNode = this; return child; }
    removeChild(child: any) { this.children = this.children.filter((item) => item !== child); child.parentNode = null; return child; }
    insertBefore(child: any, before: any) {
      const index = before ? this.children.indexOf(before) : -1;
      if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
      child.parentNode = this;
      return child;
    }
    addEventListener() {}
    removeEventListener() {}
    setAttribute(key: string, value: any) { this.props[key] = value; }
    removeAttribute(key: string) { delete this.props[key]; }
    get textContent(): string {
      return this.ownText + this.children.map((child) => child.nodeType === 3 ? child.nodeValue : (child.textContent || '')).join('');
    }
    set textContent(value: string) { this.ownText = value; this.children = []; }
  }

  const doc: any = {
    nodeType: 9,
    documentElement: new DummyElement(),
    activeElement: null,
    createElement(tag: string) {
      const element = new DummyElement();
      element.tagName = tag.toUpperCase();
      element.ownerDocument = doc;
      return element;
    },
    createElementNS(_namespace: string, tag: string) { return this.createElement(tag); },
    createTextNode(text: string) { return { nodeType: 3, nodeValue: text, parentNode: null }; },
    createComment() { return { nodeType: 8, nodeValue: '', parentNode: null }; },
    addEventListener() {},
    removeEventListener() {},
    defaultView: globalThis,
  };
  doc.documentElement.ownerDocument = doc;

  const location = {
    origin: 'http://localhost',
    pathname: '/pos',
    href: 'http://localhost/pos',
    reload: () => {},
  };
  Object.assign(globalThis, {
    HTMLIFrameElement: class {},
    HTMLElement: DummyElement,
    window: globalThis,
    document: doc,
    localStorage: localStore,
    sessionStorage: sessionStore,
    location,
    addEventListener: () => {},
    removeEventListener: () => {},
    fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
      auditAuthorization = new Headers(init?.headers).get('authorization') || '';
      auditPayload = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const container = new DummyElement();
  container.ownerDocument = doc;
  const CrashingChild: React.FC = () => {
    throw new Error(`CRITICAL_DATABASE_ERROR: connection refused with token ${secretToken}`);
  };
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(container as any);
  console.error = () => {};

  try {
    root.render(
      React.createElement(GlobalErrorRecoveryProvider, null, React.createElement(CrashingChild))
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(container.textContent.includes('PRODX POS encountered a runtime error'), 'The mounted provider must render the internal crash fallback');
    assert.ok(!container.textContent.includes(secretToken), 'The cashier fallback must not expose raw exception details');
    assert.ok(auditPayload, 'The caught crash must be sent through the existing authenticated audit endpoint');
    assert.equal(auditAuthorization, 'Bearer test-pos-session-token');
    assert.equal(auditPayload?.details?.message, 'An unexpected application error occurred. Sensitive details are withheld.');
    assert.equal(auditPayload?.details?.errorName, 'Error');
    assert.ok(!JSON.stringify(auditPayload).includes(secretToken), 'Audit payload must not contain raw exception data');
    assert.ok(!JSON.stringify(auditPayload).includes('connection refused'));
    assert.equal(auditPayload?.details?.errorStack, undefined, 'Raw stack must not be persisted to the audit API');
  } finally {
    root.unmount();
    // React schedules passive-effect cleanup after unmount; let it remove the
    // provider's window listeners before restoring the Node test globals.
    await new Promise((resolve) => setTimeout(resolve, 50));
    console.error = originalConsoleError;
    for (const [key, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  }
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
  const validTx1 = {
    id: 'tx-001',
    type: 'order_transaction',
    idempotencyKey: 'idem-001',
    payload: { amount: 1500 },
    createdAt: '2026-11-15T12:00:00.000Z',
    syncState: 'queued',
  };
  const validTx2 = {
    id: 'tx-002',
    type: 'stock_adjustment',
    idempotencyKey: 'idem-002',
    payload: { amount: 2500 },
    createdAt: '2026-11-15T12:01:00.000Z',
    syncState: 'queued',
  };
  const corruptedItem1 = { badDataWithoutId: true }; // missing id, type, idempotencyKey
  const corruptedItem2 = {
    id: 'tx-003',
    type: 'invalid_type', // violates domain enum
    idempotencyKey: 'idem-003',
    payload: { amount: 100 },
    createdAt: '2026-11-15T12:02:00.000Z',
    syncState: 'queued',
  };
  const nullItem = null;

  const rawQueue = [validTx1, corruptedItem1, validTx2, corruptedItem2, nullItem];
  storage.setItem('prodx_pos_outbox', JSON.stringify(rawQueue));

  const result = sanitizeAndRestoreAppState('outbox', storage);

  assert.equal(result.success, true, 'Recovery must succeed when valid transactions are preserved');
  assert.match(result.message, /Quarantined 3 corrupted outbox queue items/);
  assert.match(result.message, /preserved 2 valid pending transactions/);

  // Outbox now holds only the 2 valid transactions
  const outboxAfter = JSON.parse(storage.getItem('prodx_pos_outbox')!);
  assert.equal(outboxAfter.length, 2, 'Valid transactions must remain in outbox');
  assert.equal(outboxAfter[0].id, 'tx-001');
  assert.equal(outboxAfter[1].id, 'tx-002');

  // Corrupted items must be in quarantine storage
  assert.ok(result.quarantinedKeys && result.quarantinedKeys.length > 0);
  const quarantined = JSON.parse(storage.getItem(result.quarantinedKeys![0])!);
  assert.equal(quarantined.length, 3, 'Quarantined array must hold the 3 invalid items');
});

test('sanitizeAndRestoreAppState: healthy pending transactions remain intact without modification', () => {
  const storage = new MockStorage();
  const validTx = [{
    id: 'tx-100',
    type: 'order_transaction',
    idempotencyKey: 'idem-100',
    payload: { amount: 500 },
    createdAt: '2026-11-15T12:00:00.000Z',
    syncState: 'queued',
  }];
  storage.setItem('prodx_pos_outbox', JSON.stringify(validTx));

  const result = sanitizeAndRestoreAppState('outbox', storage);

  assert.equal(result.success, true);
  assert.match(result.message, /Verified 1 pending offline transactions intact/);
  assert.equal(storage.getItem('prodx_pos_outbox'), JSON.stringify(validTx));
  assert.equal(result.quarantinedKeys?.length ?? 0, 0, 'No keys should be quarantined for healthy outbox');
});

test('sanitizeAndRestoreAppState: storage failure during quarantine fails closed and preserves outbox intact', () => {
  const store = new Map<string, string>();
  const failingStorage = {
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      if (key.includes('quarantine')) {
        throw new Error('QuotaExceededError: DOM Exception 22');
      }
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
  };

  const rawOutbox = JSON.stringify([
    { id: 'tx-001', type: 'order_transaction', idempotencyKey: 'idem-1', payload: { ok: true }, createdAt: '2026-11-15T12:00:00.000Z', syncState: 'queued' },
    { corrupted: true },
  ]);
  store.set('prodx_pos_outbox', rawOutbox);

  const result = sanitizeAndRestoreAppState('outbox', failingStorage);

  assert.equal(result.success, false, 'Must fail closed when quarantine storage throws');
  assert.match(result.message, /fail-closed preservation kept original outbox intact/i);
  assert.equal(failingStorage.getItem('prodx_pos_outbox'), rawOutbox, 'Original outbox must remain byte-identical');
});

test('sanitizeAndRestoreAppState: quarantine read-after-write mismatch fails closed and preserves outbox intact', () => {
  const store = new Map<string, string>();
  const corruptedStorage = {
    getItem(key: string): string | null {
      if (key.includes('quarantine')) {
        return 'CORRUPTED_READ_BACK'; // Simulate storage silent truncation or corruption
      }
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
  };

  const rawOutbox = JSON.stringify([
    { id: 'tx-001', type: 'order_transaction', idempotencyKey: 'idem-1', payload: { ok: true }, createdAt: '2026-11-15T12:00:00.000Z', syncState: 'queued' },
    { corrupted: true },
  ]);
  store.set('prodx_pos_outbox', rawOutbox);

  const result = sanitizeAndRestoreAppState('outbox', corruptedStorage);

  assert.equal(result.success, false, 'Must fail closed when quarantine read-after-write verification fails');
  assert.equal(corruptedStorage.getItem('prodx_pos_outbox'), rawOutbox, 'Original outbox must remain untouched');
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

test('sanitizeAndRestoreAppState: unparseable outbox when quarantine write fails reports quarantine backup failure and never claims raw content was quarantined', () => {
  const store = new Map<string, string>();
  const failingStorage = {
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      if (key.includes('quarantine')) {
        throw new Error('QuotaExceededError: DOM Exception 22');
      }
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
  };

  const unparseableOutbox = '{"corrupted_outbox": [unterminated_json';
  store.set('prodx_pos_outbox', unparseableOutbox);

  const result = sanitizeAndRestoreAppState('outbox', failingStorage);

  assert.equal(result.success, false, 'Must return success: false when outbox is unparseable and quarantine fails');
  assert.equal(failingStorage.getItem('prodx_pos_outbox'), unparseableOutbox, 'Original outbox must be preserved intact');
  assert.deepEqual(result.quarantinedKeys, [], 'Failed quarantine key must not be included in quarantinedKeys');
  assert.match(result.message, /Quarantine backup failed; original content preserved intact/i);
  assert.doesNotMatch(result.message, /Raw content quarantined to/i);
});

test('ErrorBoundary: custom fallback function receives sanitized safeError with withheld message and stack', async () => {
  const { ErrorBoundary } = await import('../components/common/ErrorBoundary');
  const sensitiveError = new TypeError('SECRET_DB_TOKEN=sk_live_999999');
  sensitiveError.stack = 'TypeError: SECRET_DB_TOKEN=sk_live_999999\n    at CheckoutService.charge (pos.ts:42:13)';

  let receivedError: Error | null = null;
  let receivedReset: (() => void) | null = null;

  const derivedState = ErrorBoundary.getDerivedStateFromError(sensitiveError);
  const boundary = new ErrorBoundary({
    children: React.createElement('div', null, 'POS Child'),
    fallback: (err, reset) => {
      receivedError = err;
      receivedReset = reset;
      return React.createElement('div', { id: 'custom-fallback' }, `${err.name}:${err.message}`);
    },
  });

  boundary.state = {
    ...boundary.state,
    ...derivedState,
  };

  const rendered = boundary.render() as ReactElement;
  assert.ok(rendered);
  assert.ok(receivedError, 'Custom fallback function must be invoked with an Error instance');
  assert.equal((receivedError as Error).name, 'TypeError', 'Validated errorName must be preserved on safeError');
  assert.equal((receivedError as Error).message, 'An unexpected component render error occurred.');
  assert.equal((receivedError as Error).stack, undefined, 'Raw stack trace must be cleared on safeError');
  assert.ok(!JSON.stringify(rendered).includes('sk_live_999999'), 'Sensitive error message must never reach custom fallback');
  assert.equal(typeof receivedReset, 'function', 'Reset callback must be provided to custom fallback');

  // Verify attacker-controlled error.name falls back to RenderError
  const malformedNameError = Object.assign(new Error('leak'), { name: 'Bearer sk_live_999999' });
  const malformedDerived = ErrorBoundary.getDerivedStateFromError(malformedNameError);
  boundary.state = {
    ...boundary.state,
    ...malformedDerived,
  };
  boundary.render();
  assert.equal((receivedError as Error).name, 'RenderError');
});

