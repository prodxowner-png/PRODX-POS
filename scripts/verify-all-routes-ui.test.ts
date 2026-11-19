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

test('evaluateRouteIdentity rejects stuck-on-Dashboard snapshots even when Sidebar labels appear in bodyText', () => {
  const stuckOnDashboard = {
    bodyText:
      'POS\nDashboard\nOrders\nShift\nInventory\nCustomers\nAudit\nKitchen Display\nTask Manager\nSettings\nOperational Sales Dashboard\nSales Overview',
    mainText: 'Operational Sales Dashboard\nSales Overview',
    headingsText: 'Operational Sales Dashboard | Sales Overview',
    activeNavText: 'Dashboard',
    matchedSelectors: ['main', 'h1'],
    hasCrashBoundary: false,
    hasErrorBoundaryFallback: false,
  };

  const dashEval = evaluateRouteIdentity(ROUTE_IDENTITY_SPECS.dashboard, stuckOnDashboard);
  assert.equal(dashEval.matched, true);

  const otherOperationalRoutes = [
    'pos',
    'orders',
    'shift',
    'inventory',
    'customers',
    'audit',
    'settings',
    'kds',
    'tasks',
  ];

  for (const route of otherOperationalRoutes) {
    const res = evaluateRouteIdentity(ROUTE_IDENTITY_SPECS[route], stuckOnDashboard);
    assert.equal(
      res.matched,
      false,
      `Expected route "${route}" to FAIL when stuck on Dashboard with Sidebar labels in bodyText`,
    );
  }
});

test('evaluateRouteIdentity fails on all 3 real RbacGuard denied-card variants and real ErrorBoundary markers', () => {
  const rbacCases: Array<{ route: string; heading: string; deniedText: string }> = [
    {
      route: 'settings',
      heading: 'Unified Enterprise Settings & Control Hub',
      deniedText: 'Organization Admin Required\nRBAC Middleware Policy: Org-Level Guard Active',
    },
    {
      route: 'dashboard',
      heading: 'Operational Sales Dashboard',
      deniedText: 'POS-Only Access Policy\nRBAC Middleware Policy: POS-Only Enforced',
    },
    {
      route: 'inventory',
      heading: 'Inventory & Stock Ledger',
      deniedText: 'RBAC Access Restricted\nProtected Enterprise Module',
    },
  ];

  for (const tc of rbacCases) {
    const res = evaluateRouteIdentity(ROUTE_IDENTITY_SPECS[tc.route], {
      bodyText: `${tc.heading}\n${tc.deniedText}`,
      mainText: `${tc.heading}\n${tc.deniedText}`,
      headingsText: tc.heading,
      activeNavText: tc.route,
      matchedSelectors: ['main', 'h1'],
      hasCrashBoundary: false,
      hasErrorBoundaryFallback: false,
    });
    assert.equal(res.matched, false, `Expected RbacGuard denied card to FAIL for "${tc.route}"`);
    assert.ok(res.reasons.some((r) => r.includes('Forbidden fallback marker')));
  }

  // Real global ErrorBoundary.tsx text ("Terminal Runtime Interrupted")
  const globalBoundaryText = evaluateRouteIdentity(ROUTE_IDENTITY_SPECS.dashboard, {
    bodyText: 'Terminal Runtime Interrupted\nException Caught: Boom',
    mainText: 'Operational Sales Dashboard',
    headingsText: 'Operational Sales Dashboard',
    activeNavText: 'Dashboard',
    matchedSelectors: ['main', 'h1'],
    hasCrashBoundary: false,
    hasErrorBoundaryFallback: false,
  });
  assert.equal(globalBoundaryText.matched, false);
  assert.ok(globalBoundaryText.reasons.some((r) => r.includes('Forbidden fallback marker')));

  // Real module ErrorBoundary.tsx text (EN + TH)
  const moduleBoundaryText = evaluateRouteIdentity(ROUTE_IDENTITY_SPECS.orders, {
    bodyText: 'Orders Encountered an Issue\nส่วนการทำงานนี้เกิดข้อผิดพลาดชั่วคราว',
    mainText: 'Order Journal & Receipts\nOrders Encountered an Issue',
    headingsText: 'Order Journal & Receipts',
    activeNavText: 'Orders',
    matchedSelectors: ['main', 'h1'],
    hasCrashBoundary: false,
    hasErrorBoundaryFallback: false,
  });
  assert.equal(moduleBoundaryText.matched, false);
  assert.ok(moduleBoundaryText.reasons.some((r) => r.includes('Forbidden fallback marker')));

  // Real ErrorBoundary DOM selector flag
  const moduleBoundaryFlag = evaluateRouteIdentity(ROUTE_IDENTITY_SPECS.orders, {
    bodyText: 'Order Journal & Receipts',
    mainText: 'Order Journal & Receipts',
    headingsText: 'Order Journal & Receipts',
    activeNavText: 'Orders',
    matchedSelectors: ['main', 'h1'],
    hasCrashBoundary: false,
    hasErrorBoundaryFallback: true,
  });
  assert.equal(moduleBoundaryFlag.matched, false);
  assert.ok(moduleBoundaryFlag.reasons.some((r) => r.includes('Crash/ErrorBoundary')));
});

test('evaluateRouteIdentity matches real OrdersScreen EN heading, requires POS cart selector, and rejects bare PRODX on customer-display', () => {
  const realOrders = evaluateRouteIdentity(ROUTE_IDENTITY_SPECS.orders, {
    bodyText: 'Sidebar\nOrder Journal & Receipts\nFilter receipts',
    mainText: 'Order Journal & Receipts\nFilter receipts',
    headingsText: 'Order Journal & Receipts',
    activeNavText: '',
    matchedSelectors: ['main', 'h1'],
    hasCrashBoundary: false,
    hasErrorBoundaryFallback: false,
  });
  assert.equal(realOrders.matched, true);
  assert.deepEqual(realOrders.reasons, []);

  // POS without required cart panel selector must FAIL
  const posMissingCart = evaluateRouteIdentity(ROUTE_IDENTITY_SPECS.pos, {
    bodyText: 'POS Cart Checkout',
    mainText: 'POS Cart Checkout',
    headingsText: '',
    activeNavText: 'POS',
    matchedSelectors: ['main'],
    hasCrashBoundary: false,
    hasErrorBoundaryFallback: false,
  });
  assert.equal(posMissingCart.matched, false);
  assert.ok(
    posMissingCart.reasons.some((r) => r.includes('[aria-label="Order Cart and Checkout Panel"]')),
  );

  // POS with required cart panel selector PASSES
  const posValid = evaluateRouteIdentity(ROUTE_IDENTITY_SPECS.pos, {
    bodyText: 'POS Cart Checkout',
    mainText: 'Order Cart Checkout',
    headingsText: '',
    activeNavText: 'POS',
    matchedSelectors: ['main', '[aria-label="Order Cart and Checkout Panel"]'],
    hasCrashBoundary: false,
    hasErrorBoundaryFallback: false,
  });
  assert.equal(posValid.matched, true);

  // customer-display must NOT pass on bare "PRODX" alone
  const bareProdx = evaluateRouteIdentity(ROUTE_IDENTITY_SPECS['customer-display'], {
    bodyText: 'PRODX',
    headingsText: '',
    activeNavText: '',
    matchedSelectors: [],
    hasCrashBoundary: false,
    hasErrorBoundaryFallback: false,
  });
  assert.equal(bareProdx.matched, false);

  // customer-display PASSES on real CustomerDisplayView content
  const realCustomerDisplay = evaluateRouteIdentity(ROUTE_IDENTITY_SPECS['customer-display'], {
    bodyText: 'PRODX Flagship Store\nยินดีต้อนรับสู่ PRODX Flagship Store\nสรุปยอดค่าสินค้า (Order Summary)',
    headingsText: 'ยินดีต้อนรับสู่ PRODX Flagship Store',
    activeNavText: '',
    matchedSelectors: [],
    hasCrashBoundary: false,
    hasErrorBoundaryFallback: false,
  });
  assert.equal(realCustomerDisplay.matched, true);
});

test('verify-all-routes-ui.ts blurs activeElement before shortcuts, checks real ErrorBoundary selectors, and monitors runtime/console/network errors with detached cleanup', () => {
  const scriptSource = readFileSync(resolve(process.cwd(), 'scripts/verify-all-routes-ui.ts'), 'utf8');

  assert.match(scriptSource, /document\.activeElement\.blur\(\)/);
  assert.match(scriptSource, /#global-error-boundary-screen/);
  assert.match(scriptSource, /#global-crash-boundary-fallback/);
  assert.match(scriptSource, /\[id\^="error-boundary-module-"\]/);
  assert.match(scriptSource, /mainEl\.querySelectorAll\('h1, h2, h3'\)/);
  assert.match(scriptSource, /cdp\.on\('Runtime\.exceptionThrown'/);
  assert.match(scriptSource, /cdp\.on\('Runtime\.consoleAPICalled'/);
  assert.match(scriptSource, /cdp\.on\('Network\.loadingFailed'/);
  assert.match(scriptSource, /cdp\.on\('Network\.responseReceived'/);
  assert.match(scriptSource, /detached:\s*true/);
  assert.match(scriptSource, /process\.once\('SIGINT'/);
  assert.match(scriptSource, /process\.once\('SIGTERM'/);
});
