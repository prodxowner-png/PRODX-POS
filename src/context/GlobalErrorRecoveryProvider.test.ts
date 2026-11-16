import assert from 'node:assert/strict';
import test from 'node:test';
import React, { type ReactElement } from 'react';
import { InternalCrashBoundary } from './GlobalErrorRecoveryProvider';
import fs from 'node:fs';
import path from 'node:path';

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
