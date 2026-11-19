/**
 * PRODX POS — Full-System Multi-Route Visual Regression & Responsive Verification Suite
 *
 * Drives headless Chromium via native Chrome DevTools Protocol (CDP) WebSocket to verify:
 * - All 15 unauthenticated, operational AppShell, standalone, and Admin Console routes
 * - Explicit per-route DOM identity assertions & forbidden fallback detection
 * - Responsive viewports: Mobile (320px, 390px), Tablet (768px, 1024px), Desktop (1280px, 1440px)
 * - Horizontal overflow detection (scrollWidth <= innerWidth)
 * - Real foreground/background WCAG AA contrast sampling (headings, buttons/CTAs, badges, inputs, nav)
 * - Independent Dark Mode verification on Dashboard and Admin Console (identity + .dark + contrast)
 * - Runtime exception, console error, network failure, and HTTP >= 400 capture & fail-closed gating
 * - Isolated synthetic dev auth (production auth/Supabase env vars explicitly cleared)
 * - Deterministic process-group & Chromium temp-dir cleanup
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface ViewportSpec {
  name: string;
  width: number;
  height: number;
  mobile: boolean;
}

export interface RouteIdentitySpec {
  route: string;
  requiredSelectors?: string[];
  expectedTextPatterns: RegExp[];
  forbidLoginScreen: boolean;
  scopeToMain?: boolean;
}

export interface ContrastSample {
  category: 'heading' | 'button' | 'badge' | 'input' | 'nav' | 'body';
  tag: string;
  text: string;
  fg: RgbColor;
  bg: RgbColor;
  fontSizePx: number;
  fontWeight: number;
}

export interface ContrastEvaluation {
  sampleCount: number;
  minContrast: number;
  failedSamples: Array<{
    category: ContrastSample['category'];
    tag: string;
    text: string;
    contrast: number;
    required: number;
  }>;
  passed: boolean;
}

export interface DomIdentitySnapshot {
  bodyText: string;
  mainText?: string;
  primaryHeadingText?: string;
  headingsText: string;
  activeNavText: string;
  matchedSelectors: string[];
  hasCrashBoundary: boolean;
  hasErrorBoundaryFallback: boolean;
}

export interface RouteIdentityEvaluation {
  matched: boolean;
  reasons: string[];
}

export interface RouteErrorLog {
  uncaughtExceptions: string[];
  consoleErrors: string[];
  networkFailures: string[];
  httpErrors: string[];
}

export interface RouteAuditResult {
  route: string;
  status: 'PASS' | 'FAIL';
  identityVerified: boolean;
  identityReasons: string[];
  viewports: Record<string, { overflowPx: number }>;
  contrastMin: number;
  contrastSamples: number;
  contrastFailures: number;
  errors: RouteErrorLog;
  screenshots: string[];
  notes?: string;
}

export interface AuditGateSummary {
  totalRoutes: number;
  passedRoutes: number;
  failedRoutes: number;
  uncaughtExceptions: number;
  consoleErrors: number;
  networkFailures: number;
  httpErrors: number;
  missingRoutes: string[];
}

export const ALL_VIEWPORTS: ViewportSpec[] = [
  { name: 'desktop-1440', width: 1440, height: 900, mobile: false },
  { name: 'desktop-1280', width: 1280, height: 800, mobile: false },
  { name: 'tablet-1024', width: 1024, height: 768, mobile: false },
  { name: 'tablet-768', width: 768, height: 1024, mobile: false },
  { name: 'mobile-390', width: 390, height: 844, mobile: true },
  { name: 'mobile-320', width: 320, height: 700, mobile: true },
];

export const FORBIDDEN_FALLBACK_PATTERNS: RegExp[] = [
  /Something went wrong|Application Error|Unexpected Error|เกิดข้อผิดพลาดร้ายแรง/i,
  /Terminal Runtime Interrupted|Encountered an Issue|ส่วนการทำงานนี้เกิดข้อผิดพลาดชั่วคราว/i,
  /Administrator Console Access Denied|Access Denied|Insufficient Permissions|ปฏิเสธการเข้าถึง/i,
  /Organization Admin Required|POS-Only Access Policy|RBAC Access Restricted|RBAC Middleware Policy|Protected Enterprise Module|POS-Only Enforced|Org-Level Guard Active|สงวนสิทธิ์เฉพาะ Admin ระดับองค์กร|จำกัดสิทธิ์เฉพาะหน้า POS เท่านั้น|จำกัดสิทธิ์การเข้าถึง \(RBAC Guard\)|โมดูลที่ต้องได้รับการอนุมัติสิทธิ์|ป้องกันการเข้าถึงระดับองค์กร/i,
];

export const UNEXPECTED_LOGIN_PATTERNS: RegExp[] = [
  /High-Performance\s+Retail POS Station/i,
  /Administrator Console Login/i,
  /เข้าสู่ระบบผู้ดูแลระบบ/i,
];

export const ROUTE_IDENTITY_SPECS: Record<string, RouteIdentitySpec> = {
  login: {
    route: 'login',
    requiredSelectors: ['input'],
    expectedTextPatterns: [/High-Performance|Retail POS Station|Sign In|จุดชำระเงินอัจฉริยะ/i],
    forbidLoginScreen: false,
    scopeToMain: false,
  },
  'admin-login': {
    route: 'admin-login',
    requiredSelectors: ['input'],
    expectedTextPatterns: [/Administrator Console Login|เข้าสู่ระบบผู้ดูแลระบบ/i],
    forbidLoginScreen: false,
    scopeToMain: false,
  },
  'customer-display': {
    route: 'customer-display',
    expectedTextPatterns: [/Flagship Store|Customer Display|Order Summary|Total Due|ยินดีต้อนรับ|ชำระเงิน/i],
    forbidLoginScreen: true,
    scopeToMain: false,
  },
  'receipt-validation': {
    route: 'receipt-validation',
    expectedTextPatterns: [/PRODX\s*VALIDATOR|Receipt Validation|Verify Receipt/i],
    forbidLoginScreen: true,
    scopeToMain: false,
  },
  pos: {
    route: 'pos',
    requiredSelectors: ['main', '[aria-label="Order Cart and Checkout Panel"]'],
    expectedTextPatterns: [/POS|Point of Sale|Cart|Checkout|ขายสินค้า|ตะกร้า/i],
    forbidLoginScreen: true,
    scopeToMain: true,
  },
  dashboard: {
    route: 'dashboard',
    requiredSelectors: ['main', 'h1'],
    expectedTextPatterns: [/Dashboard|Overview|แดชบอร์ด/i],
    forbidLoginScreen: true,
    scopeToMain: true,
  },
  orders: {
    route: 'orders',
    requiredSelectors: ['main', 'h1'],
    expectedTextPatterns: [/Order Journal|Orders|Sales History|Order History|ประวัติคำสั่งซื้อ|รายการขาย|คำสั่งซื้อ/i],
    forbidLoginScreen: true,
    scopeToMain: true,
  },
  shift: {
    route: 'shift',
    requiredSelectors: ['main', 'h1'],
    expectedTextPatterns: [/Shift & Cash Drawer|Cash Drawer|กะการทำงาน/i],
    forbidLoginScreen: true,
    scopeToMain: true,
  },
  inventory: {
    route: 'inventory',
    requiredSelectors: ['main', 'h1'],
    expectedTextPatterns: [/Inventory|Stock|คลังสินค้า/i],
    forbidLoginScreen: true,
    scopeToMain: true,
  },
  customers: {
    route: 'customers',
    requiredSelectors: ['main', 'h1'],
    expectedTextPatterns: [/Customers|CRM|ลูกค้า/i],
    forbidLoginScreen: true,
    scopeToMain: true,
  },
  audit: {
    route: 'audit',
    requiredSelectors: ['main', 'h1'],
    expectedTextPatterns: [/Audit|Security|Activity Log|ประวัติการใช้งาน|ตรวจสอบ/i],
    forbidLoginScreen: true,
    scopeToMain: true,
  },
  settings: {
    route: 'settings',
    requiredSelectors: ['main', 'h1'],
    expectedTextPatterns: [/Unified Enterprise Settings|Settings|ตั้งค่า/i],
    forbidLoginScreen: true,
    scopeToMain: true,
  },
  kds: {
    route: 'kds',
    requiredSelectors: ['main', 'h1'],
    expectedTextPatterns: [/Kitchen & Preparation Orders|Kitchen|จอแสดงออเดอร์ห้องครัว/i],
    forbidLoginScreen: true,
    scopeToMain: true,
  },
  tasks: {
    route: 'tasks',
    requiredSelectors: ['main', 'h1'],
    expectedTextPatterns: [/Task Manager|My Personal Tasks|ระบบจัดการงาน|งานของฉัน/i],
    forbidLoginScreen: true,
    scopeToMain: true,
  },
  'admin-console': {
    route: 'admin-console',
    requiredSelectors: ['nav[aria-label="Administrator Console Navigation"]'],
    expectedTextPatterns: [/PRODX\s*ADMIN CONSOLE|Admin Console Modules|Organizations/i],
    forbidLoginScreen: true,
    scopeToMain: false,
  },
};

export const EXPECTED_ROUTES: string[] = Object.keys(ROUTE_IDENTITY_SPECS);
export const EXPECTED_ROUTE_COUNT = 15;

export function getLuminance(rgb: RgbColor): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

export function calculateContrast(fg: RgbColor, bg: RgbColor): number {
  const l1 = getLuminance(fg);
  const l2 = getLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
}

export function evaluateContrastSamples(samples: ContrastSample[]): ContrastEvaluation {
  if (samples.length === 0) {
    return {
      sampleCount: 0,
      minContrast: 0,
      failedSamples: [
        {
          category: 'body',
          tag: 'none',
          text: 'No visible UI elements sampled for contrast',
          contrast: 0,
          required: 4.5,
        },
      ],
      passed: false,
    };
  }

  let minContrast = Number.POSITIVE_INFINITY;
  const failedSamples: ContrastEvaluation['failedSamples'] = [];

  for (const sample of samples) {
    const contrast = calculateContrast(sample.fg, sample.bg);
    const required = isLargeText(sample.fontSizePx, sample.fontWeight) ? 3.0 : 4.5;
    if (contrast < minContrast) {
      minContrast = contrast;
    }
    if (contrast < required) {
      failedSamples.push({
        category: sample.category,
        tag: sample.tag,
        text: sample.text.slice(0, 60),
        contrast: Number(contrast.toFixed(2)),
        required,
      });
    }
  }

  return {
    sampleCount: samples.length,
    minContrast: Number((Number.isFinite(minContrast) ? minContrast : 0).toFixed(2)),
    failedSamples,
    passed: failedSamples.length === 0,
  };
}

export function evaluateRouteIdentity(
  spec: RouteIdentitySpec,
  snapshot: DomIdentitySnapshot,
): RouteIdentityEvaluation {
  const reasons: string[] = [];
  const mainText = snapshot.mainText ?? '';
  const primaryHeadingText = snapshot.primaryHeadingText ?? '';
  const fullPageText = `${primaryHeadingText}\n${snapshot.headingsText}\n${snapshot.activeNavText}\n${mainText}\n${snapshot.bodyText}`;
  const shouldScopeToMain = spec.scopeToMain ?? Boolean(spec.requiredSelectors?.includes('main'));
  const identityText = shouldScopeToMain
    ? `${primaryHeadingText}\n${snapshot.activeNavText}`
    : `${primaryHeadingText}\n${snapshot.headingsText}\n${snapshot.activeNavText}\n${snapshot.bodyText}`;

  if (snapshot.hasCrashBoundary || snapshot.hasErrorBoundaryFallback) {
    reasons.push('Crash/ErrorBoundary fallback rendered');
  }

  for (const forbidden of FORBIDDEN_FALLBACK_PATTERNS) {
    if (forbidden.test(fullPageText)) {
      reasons.push(`Forbidden fallback marker matched: ${forbidden.source}`);
    }
  }

  if (spec.forbidLoginScreen) {
    for (const loginPattern of UNEXPECTED_LOGIN_PATTERNS) {
      if (loginPattern.test(fullPageText)) {
        reasons.push(`Unexpected LoginScreen fallback matched: ${loginPattern.source}`);
      }
    }
  }

  if (spec.requiredSelectors) {
    for (const selector of spec.requiredSelectors) {
      if (!snapshot.matchedSelectors.includes(selector)) {
        reasons.push(`Missing required selector: ${selector}`);
      }
    }
  }

  const matchedExpected = spec.expectedTextPatterns.some((pattern) => pattern.test(identityText));
  if (!matchedExpected) {
    reasons.push(`Route identity heading/text not matched for "${spec.route}"`);
  }

  return {
    matched: reasons.length === 0,
    reasons,
  };
}

export function evaluateAuditGate(
  results: RouteAuditResult[],
  globalErrors: RouteErrorLog,
  expectedRoutes: string[] = EXPECTED_ROUTES,
): { passed: boolean; summary: AuditGateSummary; failureReasons: string[] } {
  const visitedRoutes = new Set(results.map((r) => r.route));
  const missingRoutes = expectedRoutes.filter((r) => !visitedRoutes.has(r));
  const failedRoutes = results.filter((r) => r.status === 'FAIL').length;
  const passedRoutes = results.filter((r) => r.status === 'PASS').length;

  const summary: AuditGateSummary = {
    totalRoutes: results.length,
    passedRoutes,
    failedRoutes,
    uncaughtExceptions: globalErrors.uncaughtExceptions.length,
    consoleErrors: globalErrors.consoleErrors.length,
    networkFailures: globalErrors.networkFailures.length,
    httpErrors: globalErrors.httpErrors.length,
    missingRoutes,
  };

  const failureReasons: string[] = [];
  if (results.length !== expectedRoutes.length) {
    failureReasons.push(`Expected ${expectedRoutes.length} routes audited, got ${results.length}`);
  }
  if (missingRoutes.length > 0) {
    failureReasons.push(`Missing routes: ${missingRoutes.join(', ')}`);
  }
  if (failedRoutes > 0) {
    failureReasons.push(`${failedRoutes} route(s) failed verification`);
  }
  if (summary.uncaughtExceptions > 0) {
    failureReasons.push(`${summary.uncaughtExceptions} uncaught runtime exception(s) captured`);
  }
  if (summary.consoleErrors > 0) {
    failureReasons.push(`${summary.consoleErrors} console error(s) captured`);
  }
  if (summary.networkFailures > 0) {
    failureReasons.push(`${summary.networkFailures} network loading failure(s) captured`);
  }
  if (summary.httpErrors > 0) {
    failureReasons.push(`${summary.httpErrors} HTTP >= 400 response(s) captured`);
  }

  return {
    passed: failureReasons.length === 0,
    summary,
    failureReasons,
  };
}

export function buildIsolatedViteEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    DISABLE_HMR: 'true',
    VITE_AUTH_API_BASE_URL: '',
    VITE_SUPABASE_URL: '',
    VITE_AUTH_PROVIDER: '',
  };
}

export function resolveViteCommand(cwd: string = process.cwd()): { command: string; args: string[] } {
  const localViteBin = resolve(cwd, 'node_modules', '.bin', 'vite');
  if (existsSync(localViteBin)) {
    return { command: localViteBin, args: [] };
  }
  return { command: 'npx', args: ['vite'] };
}

export function cleanupTempDir(dirPath: string | null): void {
  if (!dirPath) return;
  try {
    rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

export function terminateProcessGroup(proc: ChildProcess | null): void {
  if (!proc || proc.pid === undefined) return;
  const pid = proc.pid;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      proc.kill('SIGTERM');
    } catch {
      // Process may already have exited
    }
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      // Process may already have exited
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function createEmptyErrorLog(): RouteErrorLog {
  return {
    uncaughtExceptions: [],
    consoleErrors: [],
    networkFailures: [],
    httpErrors: [],
  };
}

function hasAnyError(log: RouteErrorLog): boolean {
  return (
    log.uncaughtExceptions.length > 0 ||
    log.consoleErrors.length > 0 ||
    log.networkFailures.length > 0 ||
    log.httpErrors.length > 0
  );
}

class CdpClient {
  private ws: WebSocket;
  private msgId = 1;

  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  static async connect(debuggerUrl: string): Promise<CdpClient> {
    const ws = new WebSocket(debuggerUrl);
    await new Promise<void>((res, rej) => {
      ws.onopen = () => res();
      ws.onerror = (e) => rej(new Error('WebSocket error: ' + String(e)));
    });
    return new CdpClient(ws);
  }

  on(event: string, callback: (params: Record<string, any>) => void): void {
    this.ws.addEventListener('message', (evt) => {
      try {
        const data = JSON.parse(evt.data as string);
        if (data.method === event) {
          callback(data.params);
        }
      } catch {}
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    return new Promise((res, rej) => {
      const id = this.msgId++;
      const handler = (evt: MessageEvent) => {
        try {
          const data = JSON.parse(evt.data as string);
          if (data.id === id) {
            this.ws.removeEventListener('message', handler);
            if (data.error) {
              rej(new Error(`CDP Error (${method}): ${data.error.message}`));
            } else {
              res(data.result);
            }
          }
        } catch (e) {
          rej(e);
        }
      };
      this.ws.addEventListener('message', handler);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${res.exceptionDetails.text || JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  async setViewport(spec: ViewportSpec): Promise<void> {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: spec.width,
      height: spec.height,
      deviceScaleFactor: 1,
      mobile: spec.mobile,
      screenOrientation: { angle: 0, type: spec.mobile ? 'portraitPrimary' : 'landscapePrimary' },
    });
    await sleep(250);
  }

  async captureScreenshot(filePath: string): Promise<void> {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(filePath, Buffer.from(res.data, 'base64'));
  }

  async measureOverflow(): Promise<{ scrollWidth: number; innerWidth: number; overflowPx: number }> {
    return this.evaluate(`({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth)
    })`);
  }

  async collectDomIdentity(requiredSelectors: string[] = []): Promise<DomIdentitySnapshot> {
    const selectorsJson = JSON.stringify(requiredSelectors);
    return this.evaluate<DomIdentitySnapshot>(`(() => {
      const selectors = ${selectorsJson};
      const matchedSelectors = selectors.filter((sel) => Boolean(document.querySelector(sel)));
      const mainEl = document.querySelector('main');
      const primaryHeadingNodes = mainEl
        ? document.querySelectorAll('main h1')
        : document.querySelectorAll('h1');
      const primaryHeadingText = Array.from(primaryHeadingNodes)
        .map((el) => (el.innerText || el.textContent || '').trim())
        .filter(Boolean)
        .join(' | ');
      const headingNodes = mainEl
        ? mainEl.querySelectorAll('h1, h2, h3')
        : document.querySelectorAll('h1, h2, h3');
      const headingsText = Array.from(headingNodes)
        .map((el) => (el.textContent || '').trim())
        .filter(Boolean)
        .join(' | ');
      const activeNavText = Array.from(document.querySelectorAll('[aria-current="page"]'))
        .map((el) => (el.textContent || '').trim())
        .filter(Boolean)
        .join(' | ');
      return {
        bodyText: (document.body?.innerText || '').slice(0, 4000),
        mainText: (mainEl?.innerText || '').slice(0, 4000),
        primaryHeadingText,
        headingsText,
        activeNavText,
        matchedSelectors,
        hasCrashBoundary: Boolean(
          document.querySelector('#global-error-boundary-screen, #global-crash-boundary-fallback'),
        ),
        hasErrorBoundaryFallback: Boolean(
          document.querySelector('[id^="error-boundary-module-"], [data-testid="error-boundary-fallback"]'),
        ),
      };
    })()`);
  }

  async sampleUiContrast(): Promise<{
    isDark: boolean;
    primaryVar: string;
    brandPrimaryVar: string;
    evaluation: ContrastEvaluation;
  }> {
    const raw = await this.evaluate<{
      isDark: boolean;
      primaryVar: string;
      brandPrimaryVar: string;
      samples: ContrastSample[];
    }>(`(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');

      const parseRgba = (cssColor) => {
        if (!cssColor || cssColor === 'transparent' || cssColor === 'rgba(0, 0, 0, 0)') {
          return { r: 0, g: 0, b: 0, a: 0 };
        }
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = cssColor;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
      };

      const compositeOver = (top, bottom) => {
        const a = top.a + bottom.a * (1 - top.a);
        if (a <= 0) return { r: 255, g: 255, b: 255, a: 1 };
        return {
          r: Math.round((top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a),
          g: Math.round((top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a),
          b: Math.round((top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a),
          a,
        };
      };

      const resolveEffectiveBg = (el) => {
        const layers = [];
        let node = el;
        while (node && node.nodeType === 1) {
          const cs = window.getComputedStyle(node);
          const bg = parseRgba(cs.backgroundColor);
          if (bg.a > 0) {
            layers.push(bg);
            if (bg.a >= 0.999) break;
          }
          node = node.parentElement;
        }
        let acc = { r: 255, g: 255, b: 255, a: 1 };
        for (let i = layers.length - 1; i >= 0; i--) {
          acc = compositeOver(layers[i], acc);
        }
        return { r: acc.r, g: acc.g, b: acc.b };
      };

      const isVisible = (el) => {
        const cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.5) return false;
        if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;
        const rect = el.getBoundingClientRect();
        return rect.width >= 8 && rect.height >= 8;
      };

      const selectorsByCategory = [
        ['heading', 'h1, h2, h3'],
        ['button', 'button, [role="button"], a[href]'],
        ['badge', '[class*="badge"], [data-slot="badge"]'],
        ['input', 'input, select, textarea'],
        ['nav', 'nav a, nav button, aside button'],
      ];

      const seen = new Set();
      const samples = [];

      for (const [category, selector] of selectorsByCategory) {
        const nodes = Array.from(document.querySelectorAll(selector));
        let addedForCategory = 0;
        for (const el of nodes) {
          if (addedForCategory >= 12) break;
          if (seen.has(el) || !isVisible(el)) continue;
          const label = (el.textContent || el.getAttribute('placeholder') || el.value || '').trim();
          if (!label && category !== 'input') continue;
          const cs = window.getComputedStyle(el);
          const fgRgba = parseRgba(cs.color);
          if (fgRgba.a < 0.5) continue;
          const bg = resolveEffectiveBg(el);
          const fgComposited = compositeOver(fgRgba, { ...bg, a: 1 });
          const fontSizePx = parseFloat(cs.fontSize) || 14;
          const fontWeight = parseInt(cs.fontWeight, 10) || 400;
          seen.add(el);
          samples.push({
            category,
            tag: el.tagName.toLowerCase(),
            text: label.slice(0, 60) || el.tagName.toLowerCase(),
            fg: { r: fgComposited.r, g: fgComposited.g, b: fgComposited.b },
            bg,
            fontSizePx,
            fontWeight,
          });
          addedForCategory++;
        }
      }

      const bodyCs = window.getComputedStyle(document.body);
      const bodyBg = resolveEffectiveBg(document.body);
      const bodyFg = compositeOver(parseRgba(bodyCs.color), { ...bodyBg, a: 1 });
      samples.push({
        category: 'body',
        tag: 'body',
        text: 'document.body',
        fg: { r: bodyFg.r, g: bodyFg.g, b: bodyFg.b },
        bg: bodyBg,
        fontSizePx: parseFloat(bodyCs.fontSize) || 14,
        fontWeight: parseInt(bodyCs.fontWeight, 10) || 400,
      });

      const rootCs = window.getComputedStyle(document.documentElement);
      return {
        isDark: document.documentElement.classList.contains('dark'),
        primaryVar: rootCs.getPropertyValue('--primary-color').trim(),
        brandPrimaryVar: rootCs.getPropertyValue('--brand-primary').trim(),
        samples,
      };
    })()`);

    return {
      isDark: raw.isDark,
      primaryVar: raw.primaryVar,
      brandPrimaryVar: raw.brandPrimaryVar,
      evaluation: evaluateContrastSamples(raw.samples),
    };
  }

  close(): void {
    try {
      this.ws.close();
    } catch {}
  }
}

export async function main(): Promise<void> {
  console.log('=== PRODX-POS Full-System Multi-Route Visual & Responsive Audit ===');
  const evidenceDir = resolve(process.cwd(), 'tests/browser-evidence/routes');
  mkdirSync(evidenceDir, { recursive: true });

  const DEV_PORT = 4174;
  const CDP_PORT = 9225;

  let viteProcess: ChildProcess | null = null;
  let chromeProcess: ChildProcess | null = null;
  let cdp: CdpClient | null = null;
  let userDataDir: string | null = null;
  let cleanedUp = false;

  const globalErrors: RouteErrorLog = createEmptyErrorLog();
  let activeRouteErrors: RouteErrorLog = createEmptyErrorLog();
  const results: RouteAuditResult[] = [];

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (cdp) {
      cdp.close();
      cdp = null;
    }
    terminateProcessGroup(chromeProcess);
    chromeProcess = null;
    terminateProcessGroup(viteProcess);
    viteProcess = null;
    cleanupTempDir(userDataDir);
    userDataDir = null;
  };

  const handleSignal = (signal: NodeJS.Signals) => {
    console.error(`\nReceived ${signal}, cleaning up Chromium and Vite processes...`);
    cleanup();
    process.exit(1);
  };

  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  try {
    const viteCmd = resolveViteCommand(process.cwd());
    viteProcess = spawn(
      viteCmd.command,
      [...viteCmd.args, '--port', String(DEV_PORT), '--host', '127.0.0.1'],
      {
        stdio: 'pipe',
        detached: true,
        env: buildIsolatedViteEnv(process.env),
      },
    );

    userDataDir = join(tmpdir(), `chromium-routes-audit-${process.pid}-${Date.now()}`);
    mkdirSync(userDataDir, { recursive: true });
    chromeProcess = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        `--remote-debugging-port=${CDP_PORT}`,
        '--disable-dev-shm-usage',
        '--window-size=1440,900',
        `--user-data-dir=${userDataDir}`,
        '--incognito',
        '--disk-cache-size=0',
      ],
      { stdio: 'pipe', detached: true },
    );

    let ready = false;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      try {
        const [vRes, cRes] = await Promise.all([
          fetch(`http://127.0.0.1:${DEV_PORT}`),
          fetch(`http://127.0.0.1:${CDP_PORT}/json/version`),
        ]);
        if (vRes.ok && cRes.ok) {
          ready = true;
          break;
        }
      } catch {}
    }
    if (!ready) {
      throw new Error('Vite dev server or Chromium failed to start within 20s.');
    }

    const targetRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new`, { method: 'PUT' });
    const target = await targetRes.json();
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setBypassServiceWorker', { bypass: true });
    await cdp.send('Network.clearBrowserCache');

    cdp.on('Runtime.exceptionThrown', (params) => {
      const msg =
        params.exceptionDetails?.exception?.description ||
        params.exceptionDetails?.text ||
        'Unknown runtime exception';
      globalErrors.uncaughtExceptions.push(msg);
      activeRouteErrors.uncaughtExceptions.push(msg);
    });

    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type !== 'error') return;
      const args = Array.isArray(params.args)
        ? params.args.map((a: any) => a.value ?? a.description ?? '').join(' ')
        : 'Console error';
      const msg = args.trim() || 'Console error';
      globalErrors.consoleErrors.push(msg);
      activeRouteErrors.consoleErrors.push(msg);
    });

    cdp.on('Network.loadingFailed', (params) => {
      if (params.canceled) return;
      const msg = `${params.type || 'Resource'} failed: ${params.errorText || 'unknown error'}`;
      globalErrors.networkFailures.push(msg);
      activeRouteErrors.networkFailures.push(msg);
    });

    cdp.on('Network.responseReceived', (params) => {
      const status = params.response?.status;
      if (typeof status === 'number' && status >= 400) {
        const msg = `HTTP ${status} ${params.response?.url || ''}`.trim();
        globalErrors.httpErrors.push(msg);
        activeRouteErrors.httpErrors.push(msg);
      }
    });

    const beginRouteCapture = () => {
      activeRouteErrors = createEmptyErrorLog();
    };

    const auditCurrentView = async (
      routeName: string,
      captureAllViewports = false,
    ): Promise<RouteAuditResult> => {
      const spec = ROUTE_IDENTITY_SPECS[routeName];
      if (!spec) {
        throw new Error(`No RouteIdentitySpec registered for route "${routeName}"`);
      }

      // Dismiss Start Shift modal if it popped up asynchronously on an operational route
      await cdp!.evaluate(`(() => {
        const dialog = document.querySelector("div[role='dialog']");
        if (!dialog) return;
        const txt = dialog.textContent || '';
        if (/Start Shift|เปิดกะ/i.test(txt)) {
          const closeBtn =
            dialog.querySelector("button[aria-label*='Close']") ||
            Array.from(dialog.querySelectorAll('button')).find((b) => /Skip|Later|Cancel|ปิด|ข้าม/i.test(b.textContent || ''));
          if (closeBtn) closeBtn.click();
        }
      })()`);
      await sleep(200);

      const vpMetrics: Record<string, { overflowPx: number }> = {};
      const screenshots: string[] = [];

      // Always start at Desktop 1440 to verify identity and sample real UI contrast
      await cdp!.setViewport(ALL_VIEWPORTS[0]);
      await sleep(300);

      const domSnapshot = await cdp!.collectDomIdentity(spec.requiredSelectors || []);
      const identityEval = evaluateRouteIdentity(spec, domSnapshot);
      const contrastInfo = await cdp!.sampleUiContrast();

      for (const vp of ALL_VIEWPORTS) {
        await cdp!.setViewport(vp);
        const ov = await cdp!.measureOverflow();
        vpMetrics[vp.name] = { overflowPx: ov.overflowPx };

        const shouldSnap =
          vp.name === 'desktop-1440' ||
          (captureAllViewports &&
            (vp.name === 'tablet-768' || vp.name === 'mobile-390' || vp.name === 'mobile-320'));
        if (shouldSnap) {
          const fname = `${routeName}-${vp.name}.png`;
          await cdp!.captureScreenshot(resolve(evidenceDir, fname));
          screenshots.push(`tests/browser-evidence/routes/${fname}`);
        }
      }

      // Restore 1440
      await cdp!.setViewport(ALL_VIEWPORTS[0]);

      const maxOverflow = Math.max(...Object.values(vpMetrics).map((v) => v.overflowPx));
      const routeErrors: RouteErrorLog = {
        uncaughtExceptions: [...activeRouteErrors.uncaughtExceptions],
        consoleErrors: [...activeRouteErrors.consoleErrors],
        networkFailures: [...activeRouteErrors.networkFailures],
        httpErrors: [...activeRouteErrors.httpErrors],
      };

      const failureNotes: string[] = [];
      if (!identityEval.matched) {
        failureNotes.push(`Identity: ${identityEval.reasons.join('; ')}`);
      }
      if (maxOverflow > 2) {
        failureNotes.push(`Overflow ${maxOverflow}px detected`);
      }
      if (!contrastInfo.evaluation.passed) {
        failureNotes.push(
          `Contrast failed on ${contrastInfo.evaluation.failedSamples.length}/${contrastInfo.evaluation.sampleCount} element(s) (min=${contrastInfo.evaluation.minContrast}:1)`,
        );
      }
      if (hasAnyError(routeErrors)) {
        failureNotes.push(
          `Runtime/Network errors (exc=${routeErrors.uncaughtExceptions.length}, console=${routeErrors.consoleErrors.length}, net=${routeErrors.networkFailures.length}, http=${routeErrors.httpErrors.length})`,
        );
      }

      const status: 'PASS' | 'FAIL' = failureNotes.length === 0 ? 'PASS' : 'FAIL';
      const result: RouteAuditResult = {
        route: routeName,
        status,
        identityVerified: identityEval.matched,
        identityReasons: identityEval.reasons,
        viewports: vpMetrics,
        contrastMin: contrastInfo.evaluation.minContrast,
        contrastSamples: contrastInfo.evaluation.sampleCount,
        contrastFailures: contrastInfo.evaluation.failedSamples.length,
        errors: routeErrors,
        screenshots,
        notes: failureNotes.length > 0 ? failureNotes.join(' | ') : undefined,
      };
      results.push(result);
      console.log(
        `[${status}] ${routeName.padEnd(20)} | identity=${identityEval.matched} | minContrast=${result.contrastMin}:1 (${result.contrastSamples} samples) | maxOverflow=${maxOverflow}px | shots=${screenshots.length}`,
      );
      return result;
    };

    // =========================================================================
    // 1. UNAUTHENTICATED & STANDALONE ROUTES (Forest Luxury Preset, EN Locale)
    // =========================================================================
    console.log('\n--- 1. Unauthenticated & Standalone Routes (Forest Luxury) ---');
    const forestConfig = {
      theme: { presetId: 'forest_luxury', mode: 'light' },
      branding: { customAccentColor: null, customLogo: null },
    };
    const baseInitScript = `
      try {
        localStorage.setItem('prodx_pos_language', 'en');
        localStorage.setItem('prodx_enterprise_config_v1', JSON.stringify(${JSON.stringify(forestConfig)}));
      } catch (e) {}
    `;
    const baseScriptId = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: baseInitScript,
    });

    await cdp.setViewport(ALL_VIEWPORTS[0]);
    beginRouteCapture();
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/` });
    await sleep(1800);
    await auditCurrentView('login', true);

    beginRouteCapture();
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/#admin-login` });
    await sleep(1500);
    await auditCurrentView('admin-login', true);

    beginRouteCapture();
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/?mode=customer_display` });
    await sleep(1200);
    await auditCurrentView('customer-display', false);

    beginRouteCapture();
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/?validate_receipt=true` });
    await sleep(1200);
    await auditCurrentView('receipt-validation', false);

    // =========================================================================
    // 2. AUTHENTICATED ADMIN SESSION — ALL OPERATIONAL APPSHELL ROUTES
    // =========================================================================
    console.log('\n--- 2. Authenticated AppShell Operational Routes (Admin Role) ---');
    if (baseScriptId?.identifier) {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: baseScriptId.identifier });
    }
    const nowMs = Date.now();
    const devToken = `dev-session-usr-admin-kamkokaew-${nowMs}`;
    const devExpiresAt = new Date(nowMs + 8 * 60 * 60 * 1000).toISOString();
    const operationalScope = {
      organizationId: 'org-prodx-retail',
      organizationName: 'PRODX Retail',
      organizationSlug: 'prodx',
      branchId: 'store-flagship-downtown',
      branchName: 'Flagship Downtown',
      branchCode: 'STR-01',
      branchAddress: '742 Evergreen Blvd',
      terminalId: 'term-01',
      terminalName: 'Register 01',
      terminalCode: 'REG-01',
    };
    const storedDevSession = {
      token: devToken,
      organizationSlug: 'prodx',
      storeCode: 'STR-01',
      registerId: 'REG-01',
      expiresAt: devExpiresAt,
      organizationContext: operationalScope,
      organizationId: 'org-prodx-retail',
      organizationName: 'PRODX Retail',
    };

    const authScriptId = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        try {
          localStorage.setItem('prodx_pos_language', 'en');
          localStorage.setItem('prodx_enterprise_config_v1', JSON.stringify(${JSON.stringify(forestConfig)}));
          sessionStorage.setItem('prodx_pos_session', JSON.stringify({ token: '${devToken}' }));
          localStorage.setItem('prodx.dev.auth.context', JSON.stringify(${JSON.stringify(storedDevSession)}));
          localStorage.setItem('prodx.terminal.organization_context', JSON.stringify(${JSON.stringify(operationalScope)}));
          localStorage.setItem('prodx.terminal.organization', 'prodx');
          localStorage.setItem('prodx.terminal.store', 'STR-01');
          localStorage.setItem('prodx.terminal.register', 'REG-01');
        } catch (e) {}
      `,
    });

    beginRouteCapture();
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/` });
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      const mounted = await cdp.evaluate<boolean>('!!document.querySelector("main")');
      if (mounted) break;
    }

    const dismissStartShiftIfPresent = async () => {
      for (let i = 0; i < 8; i++) {
        const closed = await cdp!.evaluate<boolean>(`(() => {
          const dialog = document.querySelector("div[role='dialog']");
          if (!dialog) return false;
          const closeBtn =
            dialog.querySelector("button[aria-label*='Close']") ||
            Array.from(dialog.querySelectorAll('button')).find((b) => /Skip|Later|Cancel|ปิด|ข้าม/i.test(b.textContent || '')) ||
            dialog.querySelector('button');
          if (closeBtn) {
            closeBtn.click();
            return true;
          }
          return false;
        })()`);
        if (closed) {
          await sleep(300);
          return;
        }
        await sleep(300);
      }
    };
    await dismissStartShiftIfPresent();

    const navigateViaShortcut = async (key: string) => {
      // Blur any focused input/select/textarea so App.tsx handleKeyDown processes F1-F10
      await cdp!.evaluate(`(() => {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', code: '${key}', bubbles: true }));
      })()`);
      await sleep(800);
    };

    // POS (F1)
    await navigateViaShortcut('F1');
    await auditCurrentView('pos', true);

    // Dashboard (F2)
    beginRouteCapture();
    await navigateViaShortcut('F2');
    await auditCurrentView('dashboard', true);

    // Orders (F3)
    beginRouteCapture();
    await navigateViaShortcut('F3');
    await auditCurrentView('orders', false);

    // Shift (F4)
    beginRouteCapture();
    await navigateViaShortcut('F4');
    await auditCurrentView('shift', false);

    // Inventory (F5)
    beginRouteCapture();
    await navigateViaShortcut('F5');
    await auditCurrentView('inventory', true);

    // Customers (F6)
    beginRouteCapture();
    await navigateViaShortcut('F6');
    await auditCurrentView('customers', false);

    // Audit (F7)
    beginRouteCapture();
    await navigateViaShortcut('F7');
    await auditCurrentView('audit', false);

    // Settings (F8)
    beginRouteCapture();
    await navigateViaShortcut('F8');
    await auditCurrentView('settings', true);

    // KDS (F10)
    beginRouteCapture();
    await navigateViaShortcut('F10');
    await auditCurrentView('kds', false);

    // Tasks (click sidebar item containing Task or งาน — FAIL if button cannot be opened)
    beginRouteCapture();
    const tasksClicked = await cdp.evaluate<boolean>(`(() => {
      const btns = Array.from(document.querySelectorAll('aside button'));
      const target = btns.find((b) => /Task|งาน/i.test(b.textContent || ''));
      if (target) { target.click(); return true; }
      return false;
    })()`);
    if (!tasksClicked) {
      results.push({
        route: 'tasks',
        status: 'FAIL',
        identityVerified: false,
        identityReasons: ['Sidebar Tasks navigation button not found'],
        viewports: {},
        contrastMin: 0,
        contrastSamples: 0,
        contrastFailures: 0,
        errors: createEmptyErrorLog(),
        screenshots: [],
        notes: 'Failed to open tasks route from sidebar navigation',
      });
      console.error('[FAIL] tasks                | Sidebar navigation button not found');
    } else {
      await sleep(800);
      await auditCurrentView('tasks', false);
    }

    // =========================================================================
    // 3. DARK MODE VERIFICATION ON DASHBOARD (IDENTITY + .dark + CONTRAST)
    // =========================================================================
    console.log('\n--- 3. Dark Mode Verification (Dashboard) ---');
    beginRouteCapture();
    await navigateViaShortcut('F2');
    await sleep(400);
    await cdp.evaluate(`document.querySelector("button[aria-label*='mode']")?.click()`);
    await sleep(500);

    const dashDarkIdentity = evaluateRouteIdentity(
      ROUTE_IDENTITY_SPECS.dashboard,
      await cdp.collectDomIdentity(ROUTE_IDENTITY_SPECS.dashboard.requiredSelectors || []),
    );
    const dashDarkMetrics = await cdp.sampleUiContrast();
    await cdp.captureScreenshot(resolve(evidenceDir, 'dashboard-dark-1440.png'));
    console.log(
      `[DARK] dashboard-dark-1440 | identity=${dashDarkIdentity.matched} | isDark=${dashDarkMetrics.isDark} | minContrast=${dashDarkMetrics.evaluation.minContrast}:1 (${dashDarkMetrics.evaluation.sampleCount} samples)`,
    );
    if (!dashDarkIdentity.matched || !dashDarkMetrics.isDark || !dashDarkMetrics.evaluation.passed) {
      throw new Error(
        `Dashboard dark mode verification failed: identity=${JSON.stringify(dashDarkIdentity)}, isDark=${dashDarkMetrics.isDark}, contrast=${JSON.stringify(dashDarkMetrics.evaluation)}`,
      );
    }

    // Switch back to Light Mode before Admin Console
    await cdp.evaluate(`document.querySelector("button[aria-label*='mode']")?.click()`);
    await sleep(400);

    // =========================================================================
    // 4. OWNER / ADMIN CONSOLE (/#admin) + DARK MODE VERIFICATION
    // =========================================================================
    console.log('\n--- 4. Owner / Admin Console ---');
    beginRouteCapture();
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/#admin` });
    await sleep(1500);
    await auditCurrentView('admin-console', true);

    if (authScriptId?.identifier) {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: authScriptId.identifier });
    }
    beginRouteCapture();
    await cdp.evaluate(`(() => {
      try {
        const cfg = JSON.parse(localStorage.getItem('prodx_enterprise_config_v1') || '{}');
        cfg.theme = { ...(cfg.theme || {}), presetId: 'forest_luxury', mode: 'dark' };
        localStorage.setItem('prodx_enterprise_config_v1', JSON.stringify(cfg));
      } catch {}
    })()`);
    await cdp.send('Page.reload', { ignoreCache: true });
    await sleep(1400);

    const adminDarkIdentity = evaluateRouteIdentity(
      ROUTE_IDENTITY_SPECS['admin-console'],
      await cdp.collectDomIdentity(ROUTE_IDENTITY_SPECS['admin-console'].requiredSelectors || []),
    );
    const adminDarkMetrics = await cdp.sampleUiContrast();
    await cdp.captureScreenshot(resolve(evidenceDir, 'admin-console-dark-1440.png'));
    console.log(
      `[DARK] admin-console-dark-1440 | identity=${adminDarkIdentity.matched} | isDark=${adminDarkMetrics.isDark} | minContrast=${adminDarkMetrics.evaluation.minContrast}:1 (${adminDarkMetrics.evaluation.sampleCount} samples)`,
    );
    if (!adminDarkIdentity.matched || !adminDarkMetrics.isDark || !adminDarkMetrics.evaluation.passed) {
      throw new Error(
        `Admin Console dark mode verification failed: identity=${JSON.stringify(adminDarkIdentity)}, isDark=${adminDarkMetrics.isDark}, contrast=${JSON.stringify(adminDarkMetrics.evaluation)}`,
      );
    }

    // Summary & Fail-Closed Gate Evaluation
    const gate = evaluateAuditGate(results, globalErrors, EXPECTED_ROUTES);
    const report = {
      timestamp: new Date().toISOString(),
      ...gate.summary,
      passed: gate.passed,
      failureReasons: gate.failureReasons,
      globalErrors,
      results,
    };
    writeFileSync(resolve(evidenceDir, 'audit-summary.json'), JSON.stringify(report, null, 2));

    console.log('\n=== Audit Complete ===');
    console.log(
      `Routes Passed: ${gate.summary.passedRoutes}/${gate.summary.totalRoutes} (expected ${EXPECTED_ROUTE_COUNT}) | Exceptions: ${gate.summary.uncaughtExceptions} | Console Errors: ${gate.summary.consoleErrors} | Network Failures: ${gate.summary.networkFailures} | HTTP>=400: ${gate.summary.httpErrors}`,
    );

    if (!gate.passed) {
      console.error('Audit gate failed:', gate.failureReasons);
      process.exitCode = 1;
    }
  } finally {
    process.off('SIGINT', handleSignal);
    process.off('SIGTERM', handleSignal);
    cleanup();
  }
}

const isDirectEntry =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectEntry) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((err) => {
      console.error('❌ Full-Route Visual Audit Error:', err);
      process.exit(1);
    });
}
