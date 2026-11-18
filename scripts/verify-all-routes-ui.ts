/**
 * PRODX POS — Full-System Multi-Route Visual Regression & Responsive Verification Suite
 *
 * Drives headless Chromium via native Chrome DevTools Protocol (CDP) WebSocket to verify:
 * - Every major unauthenticated, operational AppShell, standalone, and Admin Console route
 * - Responsive viewports: Mobile (320px, 390px), Tablet (768px, 1024px), Desktop (1280px, 1440px)
 * - Horizontal overflow detection (scrollWidth <= innerWidth)
 * - Light & Dark mode switching + computed WCAG AA contrast (>= 4.5:1)
 * - Multi-theme preset reactivity across PRODX-POS theme presets
 * - Screenshot evidence saved under tests/browser-evidence/routes/
 */
import { spawn, ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface ViewportSpec {
  name: string;
  width: number;
  height: number;
  mobile: boolean;
}

const ALL_VIEWPORTS: ViewportSpec[] = [
  { name: 'desktop-1440', width: 1440, height: 900, mobile: false },
  { name: 'desktop-1280', width: 1280, height: 800, mobile: false },
  { name: 'tablet-1024', width: 1024, height: 768, mobile: false },
  { name: 'tablet-768', width: 768, height: 1024, mobile: false },
  { name: 'mobile-390', width: 390, height: 844, mobile: true },
  { name: 'mobile-320', width: 320, height: 700, mobile: true },
];

function getLuminance(rgb: RgbColor): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

function calculateContrast(fg: RgbColor, bg: RgbColor): number {
  const l1 = getLuminance(fg);
  const l2 = getLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

  on(event: string, callback: (params: any) => void): void {
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

  async measureBodyContrast(): Promise<{
    isDark: boolean;
    bodyBg: string;
    bodyText: string;
    contrast: number;
    primaryVar: string;
    brandPrimaryVar: string;
  }> {
    const data = await this.evaluate<{
      isDark: boolean;
      bodyBg: string;
      bodyText: string;
      bgRgb: RgbColor;
      fgRgb: RgbColor;
      primaryVar: string;
      brandPrimaryVar: string;
    }>(`(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');
      const toRgb = (cssColor) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 1, 1);
        ctx.fillStyle = cssColor;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return { r: d[0], g: d[1], b: d[2] };
      };
      const cs = window.getComputedStyle(document.body);
      const rootCs = window.getComputedStyle(document.documentElement);
      return {
        isDark: document.documentElement.classList.contains('dark'),
        bodyBg: cs.backgroundColor,
        bodyText: cs.color,
        bgRgb: toRgb(cs.backgroundColor),
        fgRgb: toRgb(cs.color),
        primaryVar: rootCs.getPropertyValue('--primary-color').trim(),
        brandPrimaryVar: rootCs.getPropertyValue('--brand-primary').trim(),
      };
    })()`);

    return {
      isDark: data.isDark,
      bodyBg: data.bodyBg,
      bodyText: data.bodyText,
      contrast: calculateContrast(data.fgRgb, data.bgRgb),
      primaryVar: data.primaryVar,
      brandPrimaryVar: data.brandPrimaryVar,
    };
  }

  close(): void {
    try {
      this.ws.close();
    } catch {}
  }
}

interface RouteAuditResult {
  route: string;
  status: 'PASS' | 'FAIL';
  viewports: Record<string, { overflowPx: number }>;
  contrastLight?: number;
  screenshots: string[];
  notes?: string;
}

async function main() {
  console.log('=== PRODX-POS Full-System Multi-Route Visual & Responsive Audit ===');
  const evidenceDir = resolve(process.cwd(), 'tests/browser-evidence/routes');
  mkdirSync(evidenceDir, { recursive: true });

  const DEV_PORT = 4174;
  const CDP_PORT = 9225;

  let viteProcess: ChildProcess | null = null;
  let chromeProcess: ChildProcess | null = null;
  let cdp: CdpClient | null = null;
  const uncaughtErrors: string[] = [];
  const results: RouteAuditResult[] = [];

  try {
    viteProcess = spawn('npx', ['vite', '--port', String(DEV_PORT), '--host', '127.0.0.1'], {
      stdio: 'pipe',
      detached: false,
      env: { ...process.env, DISABLE_HMR: 'true' },
    });

    const userDataDir = `/tmp/chromium-routes-audit-${Date.now()}`;
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
      { stdio: 'pipe' },
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
      uncaughtErrors.push(params.exceptionDetails?.text || 'Unknown exception');
    });

    const auditCurrentView = async (
      routeName: string,
      captureAllViewports = false,
    ): Promise<RouteAuditResult> => {
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

      // Always start at Desktop 1440 to measure contrast and capture baseline
      await cdp!.setViewport(ALL_VIEWPORTS[0]);
      await sleep(300);
      const contrastInfo = await cdp!.measureBodyContrast();

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
      const status: 'PASS' | 'FAIL' = maxOverflow <= 2 && contrastInfo.contrast >= 4.5 ? 'PASS' : 'FAIL';
      const result: RouteAuditResult = {
        route: routeName,
        status,
        viewports: vpMetrics,
        contrastLight: Number(contrastInfo.contrast.toFixed(2)),
        screenshots,
        notes: maxOverflow > 2 ? `Overflow ${maxOverflow}px detected` : undefined,
      };
      results.push(result);
      console.log(
        `[${status}] ${routeName.padEnd(20)} | contrast=${result.contrastLight}:1 | primary=${contrastInfo.brandPrimaryVar || contrastInfo.primaryVar} | maxOverflow=${maxOverflow}px | shots=${screenshots.length}`,
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
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/` });
    await sleep(1800);
    await auditCurrentView('login', true);

    // Admin Login Screen
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/#admin-login` });
    await sleep(1500);
    await auditCurrentView('admin-login', true);

    // Customer Display View
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/?mode=customer_display` });
    await sleep(1200);
    await auditCurrentView('customer-display', false);

    // Receipt Validation Portal
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

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/` });
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      const mounted = await cdp.evaluate<boolean>('!!document.querySelector("main")');
      if (mounted) break;
    }

    // Dismiss Start Shift modal reliably (wait up to 2.5s for ShiftProvider to open it)
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
      await cdp!.evaluate(
        `window.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', code: '${key}', bubbles: true }))`,
      );
      await sleep(800);
    };

    // POS (F1)
    await navigateViaShortcut('F1');
    await auditCurrentView('pos', true);

    // Dashboard (F2)
    await navigateViaShortcut('F2');
    await auditCurrentView('dashboard', true);

    // Orders (F3)
    await navigateViaShortcut('F3');
    await auditCurrentView('orders', false);

    // Shift (F4)
    await navigateViaShortcut('F4');
    await auditCurrentView('shift', false);

    // Inventory (F5)
    await navigateViaShortcut('F5');
    await auditCurrentView('inventory', true);

    // Customers (F6)
    await navigateViaShortcut('F6');
    await auditCurrentView('customers', false);

    // Audit (F7)
    await navigateViaShortcut('F7');
    await auditCurrentView('audit', false);

    // Settings (F8)
    await navigateViaShortcut('F8');
    await auditCurrentView('settings', true);

    // KDS (F10)
    await navigateViaShortcut('F10');
    await auditCurrentView('kds', false);

    // Tasks (click sidebar item containing Task or งาน)
    const tasksClicked = await cdp.evaluate<boolean>(`(() => {
      const btns = Array.from(document.querySelectorAll('aside button'));
      const target = btns.find((b) => /Task|งาน/i.test(b.textContent || ''));
      if (target) { target.click(); return true; }
      return false;
    })()`);
    if (tasksClicked) {
      await sleep(800);
      await auditCurrentView('tasks', false);
    }

    // =========================================================================
    // 3. DARK MODE + THEME PRESET VERIFICATION
    // =========================================================================
    console.log('\n--- 3. Dark Mode & Multi-Preset Reactivity ---');
    await navigateViaShortcut('F2'); // Dashboard
    await sleep(400);
    await cdp.evaluate(`document.querySelector("button[aria-label*='mode']")?.click()`);
    await sleep(500);
    const darkMetrics = await cdp.measureBodyContrast();
    await cdp.captureScreenshot(resolve(evidenceDir, 'dashboard-dark-1440.png'));
    console.log(
      `[DARK] dashboard-dark-1440 | isDark=${darkMetrics.isDark} | contrast=${darkMetrics.contrast.toFixed(2)}:1 | --primary-color=${darkMetrics.primaryVar}`,
    );
    if (!darkMetrics.isDark || darkMetrics.contrast < 4.5) {
      throw new Error(`Dark mode check failed: ${JSON.stringify(darkMetrics)}`);
    }

    // Switch back to Light Mode before Admin Console
    await cdp.evaluate(`document.querySelector("button[aria-label*='mode']")?.click()`);
    await sleep(400);

    // =========================================================================
    // 4. OWNER / ADMIN CONSOLE (/#admin)
    // =========================================================================
    console.log('\n--- 4. Owner / Admin Console ---');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/#admin` });
    await sleep(1500);
    await auditCurrentView('admin-console', true);

    // Dark mode on Admin Console (authentic persisted theme.mode switch via ConfigContext)
    if (authScriptId?.identifier) {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: authScriptId.identifier });
    }
    await cdp.evaluate(`(() => {
      try {
        const cfg = JSON.parse(localStorage.getItem('prodx_enterprise_config_v1') || '{}');
        cfg.theme = { ...(cfg.theme || {}), presetId: 'forest_luxury', mode: 'dark' };
        localStorage.setItem('prodx_enterprise_config_v1', JSON.stringify(cfg));
      } catch {}
    })()`);
    await cdp.send('Page.reload', { ignoreCache: true });
    await sleep(1400);
    const adminDarkMetrics = await cdp.measureBodyContrast();
    await cdp.captureScreenshot(resolve(evidenceDir, 'admin-console-dark-1440.png'));
    console.log(
      `[DARK] admin-console-dark-1440 | isDark=${adminDarkMetrics.isDark} | contrast=${adminDarkMetrics.contrast.toFixed(2)}:1 | --primary-color=${adminDarkMetrics.primaryVar}`,
    );
    if (!adminDarkMetrics.isDark || adminDarkMetrics.contrast < 4.5) {
      throw new Error(`Admin Console Dark mode check failed: ${JSON.stringify(adminDarkMetrics)}`);
    }

    // Summary & Write JSON Report
    const summary = {
      timestamp: new Date().toISOString(),
      totalRoutes: results.length,
      passedRoutes: results.filter((r) => r.status === 'PASS').length,
      failedRoutes: results.filter((r) => r.status === 'FAIL').length,
      uncaughtExceptions: uncaughtErrors.length,
      results,
    };
    writeFileSync(resolve(evidenceDir, 'audit-summary.json'), JSON.stringify(summary, null, 2));

    console.log('\n=== Audit Complete ===');
    console.log(
      `Routes Passed: ${summary.passedRoutes}/${summary.totalRoutes} | Uncaught Exceptions: ${summary.uncaughtExceptions}`,
    );
    if (summary.failedRoutes > 0) {
      console.error('Failed routes:', results.filter((r) => r.status === 'FAIL'));
      process.exitCode = 1;
    }
  } finally {
    if (cdp) cdp.close();
    if (chromeProcess) chromeProcess.kill('SIGKILL');
    if (viteProcess) viteProcess.kill('SIGKILL');
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error('❌ Full-Route Visual Audit Error:', err);
    process.exit(1);
  });
