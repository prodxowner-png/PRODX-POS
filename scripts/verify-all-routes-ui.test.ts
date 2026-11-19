import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  EXPECTED_ROUTES,
  EXPECTED_ROUTE_COUNT,
  ROUTE_IDENTITY_SPECS,
  buildIsolatedViteEnv,
  cleanupTempDir,
  evaluateAuditGate,
  evaluateContrastSamples,
  evaluateRouteIdentity,
  type ContrastSample,
  type RouteAuditResult,
  type RouteErrorLog,
} from './verify-all-routes-ui.ts';

function emptyErrors(): RouteErrorLog {
  return {
    uncaughtExceptions: [],
    consoleErrors: [],
    networkFailures: [],
    httpErrors: [],
  };
}

function makePassingRouteResult(route: string): RouteAuditResult {
  return {
    route,
    status: 'PASS',
    identityVerified: true,
    identityReasons: [],
    viewports: { 'desktop-1440': { overflowPx: 0 } },
    contrastMin: 7.5,
    contrastSamples: 10,
    contrastFailures: 0,
    errors: emptyErrors(),
    screenshots: [`tests/browser-evidence/routes/${route}-desktop-1440.png`],
  };
}

test('route manifest defines all 15 routes with non-empty DOM identity patterns', () => {
  assert.equal(EXPECTED_ROUTE_COUNT, 15);
  assert.equal(EXPECTED_ROUTES.length, 15);
  assert.equal(Object.keys(ROUTE_IDENTITY_SPECS).length, 15);

  const requiredRoutes = [
    'login',
    'admin-login',
    'customer-display',
    'receipt-validation',
    'pos',
    'dashboard',
    'orders',
    'shift',
    'inventory',
    'customers',
    'audit',
    'settings',
    'kds',
    'tasks',
    'admin-console',
  ];

  for (const route of requiredRoutes) {
    const spec = ROUTE_IDENTITY_SPECS[route];
    assert.ok(spec, `Missing RouteIdentitySpec for ${route}`);
    assert.ok(
      spec.expectedTextPatterns.length > 0,
      `Route ${route} must define at least one expectedTextPattern`,
    );
  }
});

test('evaluateRouteIdentity passes on valid route DOM and fails on crash boundary, RBAC denied, or unexpected LoginScreen', () => {
  const dashSpec = ROUTE_IDENTITY_SPECS.dashboard;

  const valid = evaluateRouteIdentity(dashSpec, {
    bodyText: 'Dashboard Overview Sales Today',
    headingsText: 'Dashboard',
    activeNavText: 'Dashboard',
    matchedSelectors: ['main', 'h1'],
    hasCrashBoundary: false,
    hasErrorBoundaryFallback: false,
  });
  assert.equal(valid.matched, true);
  assert.deepEqual(valid.reasons, []);

  const crash = evaluateRouteIdentity(dashSpec, {
    bodyText: 'Dashboard',
    headingsText: 'Dashboard',
    activeNavText: 'Dashboard',
    matchedSelectors: ['main', 'h1'],
    hasCrashBoundary: true,
    hasErrorBoundaryFallback: false,
  });
  assert.equal(crash.matched, false);
  assert.ok(crash.reasons.some((r) => r.includes('Crash/ErrorBoundary')));

  const rbacDenied = evaluateRouteIdentity(ROUTE_IDENTITY_SPECS['admin-console'], {
    bodyText: 'Administrator Console Access Denied',
    headingsText: 'Administrator Console Access Denied',
    activeNavText: '',
    matchedSelectors: ['nav[aria-label="Administrator Console Navigation"]'],
    hasCrashBoundary: false,
    hasErrorBoundaryFallback: false,
  });
  assert.equal(rbacDenied.matched, false);
  assert.ok(rbacDenied.reasons.some((r) => r.includes('Forbidden fallback marker')));

  const loginFallback = evaluateRouteIdentity(dashSpec, {
    bodyText: 'High-Performance Retail POS Station',
    headingsText: 'High-Performance Retail POS Station',
    activeNavText: '',
    matchedSelectors: ['main', 'h1'],
    hasCrashBoundary: false,
    hasErrorBoundaryFallback: false,
  });
  assert.equal(loginFallback.matched, false);
  assert.ok(loginFallback.reasons.some((r) => r.includes('Unexpected LoginScreen fallback')));
});

test('evaluateContrastSamples enforces WCAG AA 4.5:1 normal and 3.0:1 large text thresholds', () => {
  const empty = evaluateContrastSamples([]);
  assert.equal(empty.passed, false);

  const lowNormal: ContrastSample[] = [
    {
      category: 'button',
      tag: 'button',
      text: 'Low Contrast CTA',
      fg: { r: 150, g: 150, b: 150 },
      bg: { r: 255, g: 255, b: 255 },
      fontSizePx: 14,
      fontWeight: 600,
    },
  ];
  const lowResult = evaluateContrastSamples(lowNormal);
  assert.equal(lowResult.passed, false);
  assert.equal(lowResult.failedSamples.length, 1);
  assert.equal(lowResult.failedSamples[0].required, 4.5);

  const validSamples: ContrastSample[] = [
    {
      category: 'heading',
      tag: 'h1',
      text: 'Dashboard',
      fg: { r: 118, g: 118, b: 118 }, // ~4.54:1 on white, large text threshold 3.0:1
      bg: { r: 255, g: 255, b: 255 },
      fontSizePx: 24,
      fontWeight: 700,
    },
    {
      category: 'button',
      tag: 'button',
      text: 'Checkout',
      fg: { r: 251, g: 248, b: 243 },
      bg: { r: 24, g: 61, b: 50 },
      fontSizePx: 14,
      fontWeight: 600,
    },
  ];
  const validResult = evaluateContrastSamples(validSamples);
  assert.equal(validResult.passed, true);
  assert.equal(validResult.failedSamples.length, 0);
});

test('evaluateAuditGate fails on missing routes, failed routes, uncaught exceptions, console errors, network failures, or HTTP >= 400', () => {
  const all15Passing = EXPECTED_ROUTES.map(makePassingRouteResult);

  const cleanGate = evaluateAuditGate(all15Passing, emptyErrors());
  assert.equal(cleanGate.passed, true);
  assert.equal(cleanGate.summary.totalRoutes, 15);
  assert.deepEqual(cleanGate.failureReasons, []);

  // Missing tasks route (14/15)
  const missingTasks = all15Passing.filter((r) => r.route !== 'tasks');
  const missingGate = evaluateAuditGate(missingTasks, emptyErrors());
  assert.equal(missingGate.passed, false);
  assert.deepEqual(missingGate.summary.missingRoutes, ['tasks']);

  // Uncaught exception
  const excGate = evaluateAuditGate(all15Passing, {
    ...emptyErrors(),
    uncaughtExceptions: ['ReferenceError: boom'],
  });
  assert.equal(excGate.passed, false);
  assert.equal(excGate.summary.uncaughtExceptions, 1);

  // Console error
  const consoleGate = evaluateAuditGate(all15Passing, {
    ...emptyErrors(),
    consoleErrors: ['React hydration error'],
  });
  assert.equal(consoleGate.passed, false);
  assert.equal(consoleGate.summary.consoleErrors, 1);

  // Network failure
  const netGate = evaluateAuditGate(all15Passing, {
    ...emptyErrors(),
    networkFailures: ['Fetch failed: net::ERR_FAILED'],
  });
  assert.equal(netGate.passed, false);
  assert.equal(netGate.summary.networkFailures, 1);

  // HTTP >= 400
  const httpGate = evaluateAuditGate(all15Passing, {
    ...emptyErrors(),
    httpErrors: ['HTTP 500 http://127.0.0.1:4174/api/test'],
  });
  assert.equal(httpGate.passed, false);
  assert.equal(httpGate.summary.httpErrors, 1);
});

test('buildIsolatedViteEnv clears production auth and Supabase env vars and cleanupTempDir removes temp profile dir', () => {
  const isolated = buildIsolatedViteEnv({
    PATH: process.env.PATH,
    VITE_AUTH_API_BASE_URL: 'https://prod.example.com/auth',
    VITE_SUPABASE_URL: 'https://prod.supabase.co',
    VITE_AUTH_PROVIDER: 'production',
  });

  assert.equal(isolated.DISABLE_HMR, 'true');
  assert.equal(isolated.VITE_AUTH_API_BASE_URL, '');
  assert.equal(isolated.VITE_SUPABASE_URL, '');
  assert.equal(isolated.VITE_AUTH_PROVIDER, '');

  const tempDir = mkdtempSync(join(tmpdir(), 'prodx-verify-routes-cleanup-'));
  writeFileSync(join(tempDir, 'sentinel.txt'), 'ok');
  assert.equal(existsSync(tempDir), true);

  cleanupTempDir(tempDir);
  assert.equal(existsSync(tempDir), false);
});

test('verify-all-routes-ui.ts blurs activeElement before shortcuts and monitors runtime/console/network errors with detached cleanup', () => {
  const scriptSource = readFileSync(resolve(process.cwd(), 'scripts/verify-all-routes-ui.ts'), 'utf8');

  assert.match(scriptSource, /document\.activeElement\.blur\(\)/);
  assert.match(scriptSource, /cdp\.on\('Runtime\.exceptionThrown'/);
  assert.match(scriptSource, /cdp\.on\('Runtime\.consoleAPICalled'/);
  assert.match(scriptSource, /cdp\.on\('Network\.loadingFailed'/);
  assert.match(scriptSource, /cdp\.on\('Network\.responseReceived'/);
  assert.match(scriptSource, /detached:\s*true/);
  assert.match(scriptSource, /process\.once\('SIGINT'/);
  assert.match(scriptSource, /process\.once\('SIGTERM'/);
});
