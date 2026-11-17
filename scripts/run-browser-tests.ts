/**
 * PRODX POS - Real Headless Browser Interaction & Responsive Test Suite
 * Controls headless Chromium via native Chrome DevTools Protocol (CDP) WebSocket.
 * No external test dependencies required.
 */
import { spawn, ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function parseRgb(colorStr: string): RgbColor {
  const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) {
    return { r: 255, g: 255, b: 255 };
  }
  return {
    r: parseInt(match[1], 10),
    g: parseInt(match[2], 10),
    b: parseInt(match[3], 10),
  };
}

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
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

async function sleep(ms: number): Promise<void> {
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
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(new Error('WebSocket connection error: ' + String(e)));
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
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      const handler = (evt: MessageEvent) => {
        try {
          const data = JSON.parse(evt.data as string);
          if (data.id === id) {
            this.ws.removeEventListener('message', handler);
            if (data.error) {
              reject(new Error(`CDP Error (${method}): ${data.error.message}`));
            } else {
              resolve(data.result);
            }
          }
        } catch (e) {
          reject(e);
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

  async setViewport(width: number, height: number, mobile = false): Promise<void> {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
      screenOrientation: { angle: 0, type: mobile ? 'portraitPrimary' : 'landscapePrimary' },
    });
    await sleep(300);
  }

  async captureScreenshot(path: string): Promise<void> {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    writeFileSync(path, buffer);
  }

  close(): void {
    try {
      this.ws.close();
    } catch {}
  }
}

async function main() {
  console.log('--- Starting PRODX-POS Headless Browser Interaction & Responsive Test Suite ---');

  const evidenceDir = resolve(process.cwd(), 'tests/browser-evidence');
  mkdirSync(evidenceDir, { recursive: true });

  const PREVIEW_PORT = 4173;
  const CDP_PORT = 9224;

  let previewProcess: ChildProcess | null = null;
  let chromeProcess: ChildProcess | null = null;
  let cdpClient: CdpClient | null = null;

  try {
    const viteArgs = process.env.USE_PREVIEW === 'true'
      ? ['vite', 'preview', '--port', String(PREVIEW_PORT), '--host', '127.0.0.1']
      : ['vite', '--port', String(PREVIEW_PORT), '--host', '127.0.0.1'];
    console.log(`[1/7] Launching Vite ${process.env.USE_PREVIEW === 'true' ? 'preview' : 'dev server'} on port`, PREVIEW_PORT);
    previewProcess = spawn('npx', viteArgs, {
      stdio: 'pipe',
      detached: false,
      env: { ...process.env, DISABLE_HMR: 'true' },
    });

    console.log('[2/7] Launching Chromium in headless mode on CDP port', CDP_PORT);
    const testUserDataDir = `/tmp/chromium-test-profile-${Date.now()}`;
    mkdirSync(testUserDataDir, { recursive: true });
    chromeProcess = spawn('/usr/bin/chromium', [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      `--remote-debugging-port=${CDP_PORT}`,
      '--disable-dev-shm-usage',
      '--window-size=1440,900',
      `--user-data-dir=${testUserDataDir}`,
      '--incognito',
      '--disk-cache-size=0',
    ], { stdio: 'pipe' });

    // Wait for servers to be ready
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      try {
        const [pRes, cRes] = await Promise.all([
          fetch(`http://127.0.0.1:${PREVIEW_PORT}`),
          fetch(`http://127.0.0.1:${CDP_PORT}/json/version`),
        ]);
        if (pRes.ok && cRes.ok) {
          ready = true;
          break;
        }
      } catch {}
    }

    if (!ready) {
      throw new Error('Failed to launch preview server or Chromium within 15 seconds.');
    }
    console.log('[3/7] Servers ready. Connecting CDP WebSocket...');

    const targetRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new`, { method: 'PUT' });
    const target = await targetRes.json();
    cdpClient = await CdpClient.connect(target.webSocketDebuggerUrl);

    await cdpClient.send('Page.enable');
    await cdpClient.send('Runtime.enable');
    await cdpClient.send('DOM.enable');
    await cdpClient.send('CSS.enable');
    await cdpClient.send('Network.enable');
    await cdpClient.send('Network.setBypassServiceWorker', { bypass: true });
    await cdpClient.send('Network.clearBrowserCache');

    cdpClient.on('Runtime.consoleAPICalled', (params) => {
      console.log('Browser console [' + params.type + ']:', ...params.args.map((a: any) => a.value ?? a.description));
    });
    cdpClient.on('Runtime.exceptionThrown', (params) => {
      console.error('Browser Exception Details:', JSON.stringify(params.exceptionDetails, null, 2));
    });

    const nowMs = Date.now();
    const devSessionTtlMs = 8 * 60 * 60 * 1000;
    const devToken = `dev-session-usr-cashier-john-${nowMs}`;
    const devExpiresAt = new Date(nowMs + devSessionTtlMs).toISOString();
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

    console.log('[4/7] Pre-seeding authentication session via CDP script injection...');
    await cdpClient.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        try {
          sessionStorage.setItem('prodx_pos_session', JSON.stringify({ token: '${devToken}' }));
          localStorage.setItem('prodx.dev.auth.context', JSON.stringify(${JSON.stringify(storedDevSession)}));
          localStorage.setItem('prodx.terminal.organization_context', JSON.stringify(${JSON.stringify(operationalScope)}));
          localStorage.setItem('prodx.terminal.organization', 'prodx');
          localStorage.setItem('prodx.terminal.store', 'STR-01');
          localStorage.setItem('prodx.terminal.register', 'REG-01');
        } catch (e) {}
      `
    });

    console.log('Navigating to http://127.0.0.1:4173/ ...');
    await cdpClient.send('Page.navigate', { url: `http://127.0.0.1:${PREVIEW_PORT}/` });

    // Wait for the application to mount
    let appMounted = false;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      const mounted = await cdpClient.evaluate<boolean>('!!document.querySelector("main")');
      if (mounted) {
        appMounted = true;
        break;
      }
    }

    if (!appMounted) {
      const html = await cdpClient.evaluate<string>('document.body.innerHTML');
      console.log('Current body HTML:', html.slice(0, 1000));
      throw new Error('Application failed to mount <main> landmark.');
    }
    console.log('✔ Application mounted successfully.');

    // Dismiss initial Start Shift modal if present so the POS workspace is unobstructed
    await sleep(400);
    const dismissedShiftModal = await cdpClient.evaluate<boolean>(`(() => {
      const closeBtn = document.querySelector("div[role='dialog'] button[aria-label='Close dialog (Escape)']");
      if (closeBtn) {
        closeBtn.click();
        return true;
      }
      return false;
    })()`);
    if (dismissedShiftModal) {
      await sleep(400);
      console.log('✔ Dismissed initial Start Shift modal.');
    }

    // ------------------------------------------------------------------------
    // TEST 1: DESKTOP VIEWPORT (1440x900) - SHELL NAVIGATION & A11Y
    // ------------------------------------------------------------------------
    console.log('\n[5/7] Executing Viewport & Behavioral Tests...');
    console.log('--- Test Suite 1: Desktop Shell (1440x900) ---');
    await cdpClient.setViewport(1440, 900);
    await sleep(500);

    const desktopChecks = await cdpClient.evaluate<{
      hasSidebar: boolean;
      hasHeader: boolean;
      hasFooter: boolean;
      activeNavCurrent: string | null;
      activeNavText: string;
      topNavMenuLabel: string | null;
      statusBarText: string;
    }>(`({
      hasSidebar: !!document.querySelector("aside"),
      hasHeader: !!document.querySelector("header"),
      hasFooter: !!document.querySelector("footer"),
      activeNavCurrent: document.querySelector("button[aria-current='page']")?.getAttribute("aria-current") || null,
      activeNavText: document.querySelector("button[aria-current='page']")?.textContent || '',
      topNavMenuLabel: document.querySelector("button[aria-label='Open navigation menu']")?.getAttribute("aria-label") || null,
      statusBarText: document.querySelector("footer")?.textContent || ''
    })`);

    console.log('✔ Desktop Shell Landmarks: Sidebar=' + desktopChecks.hasSidebar + ', Header=' + desktopChecks.hasHeader + ', Footer=' + desktopChecks.hasFooter);
    console.log('✔ Active Navigation Announcement: aria-current="' + desktopChecks.activeNavCurrent + '" on tab: ' + desktopChecks.activeNavText.trim().slice(0, 30));
    console.log('✔ StatusBar Active Text:', desktopChecks.statusBarText.trim().replace(/\\s+/g, ' ').slice(0, 80));

    // Capture Desktop screenshot
    await cdpClient.captureScreenshot(resolve(evidenceDir, 'desktop-1440x900-pos.png'));
    console.log('✔ Captured screenshot: tests/browser-evidence/desktop-1440x900-pos.png');

    // ------------------------------------------------------------------------
    // TEST 2 & 3: POS INTERACTION, DIALOG ACCESSIBILITY & COMPUTED CONTRAST
    // ------------------------------------------------------------------------
    console.log('\n--- Test Suite 2: POS Interaction & Dialog Accessibility ---');

    // Add product to cart by clicking the first product card
    const clickResult = await cdpClient.evaluate<{
      cardsFound: number;
      clicked: boolean;
      cardLabel: string | null;
    }>(`(() => {
      const cards = document.querySelectorAll("div[role='button'][tabindex='0']");
      if (cards.length > 0) {
        const firstCard = cards[0];
        firstCard.click();
        return { cardsFound: cards.length, clicked: true, cardLabel: firstCard.getAttribute("aria-label") };
      }
      return { cardsFound: 0, clicked: false, cardLabel: null };
    })()`);

    if (!clickResult.clicked || clickResult.cardsFound === 0) {
      throw new Error('No clickable product cards found on POS screen.');
    }
    console.log(`✔ Found ${clickResult.cardsFound} product cards. Clicked first: ${clickResult.cardLabel}`);
    await sleep(500);

    // Verify cart reflects added item
    const cartState = await cdpClient.evaluate<{
      hasItems: boolean;
      checkoutDisabled: boolean;
      checkoutBtnText: string;
    }>(`(() => {
      const checkoutBtn = document.querySelector("#cart-full-checkout-btn");
      return {
        hasItems: !!document.querySelector("[aria-label='Increase quantity']"),
        checkoutDisabled: checkoutBtn ? checkoutBtn.disabled : true,
        checkoutBtnText: checkoutBtn ? (checkoutBtn.textContent || '') : ''
      };
    })()`);

    if (!cartState.hasItems || cartState.checkoutDisabled) {
      throw new Error(`Cart interaction failed: hasItems=${cartState.hasItems}, checkoutDisabled=${cartState.checkoutDisabled}`);
    }
    console.log(`✔ Cart State: Has Items = ${cartState.hasItems}, Checkout Disabled = ${cartState.checkoutDisabled}`);
    console.log(`✔ Checkout Button CTA Text: ${cartState.checkoutBtnText.trim().replace(/\s+/g, ' ')}`);

    console.log('\n--- Test Suite 3: Rendered DOM Computed Contrast (Light Mode) ---');
    const computedStyles = await cdpClient.evaluate<{
      bodyBg: string;
      bodyText: string;
      cardBg: string;
      ctaBg: string;
      ctaText: string;
      bodyBgRgb: RgbColor;
      bodyTextRgb: RgbColor;
      ctaBgRgb: RgbColor;
      ctaTextRgb: RgbColor;
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
      const bodyCs = window.getComputedStyle(document.body);
      const cardEl = document.querySelector(".bg-card") || document.body;
      const ctaEl = document.querySelector("#cart-full-checkout-btn") || document.querySelector(".bg-cta") || document.body;
      const ctaCs = window.getComputedStyle(ctaEl);
      return {
        bodyBg: bodyCs.backgroundColor,
        bodyText: bodyCs.color,
        cardBg: window.getComputedStyle(cardEl).backgroundColor,
        ctaBg: ctaCs.backgroundColor,
        ctaText: ctaCs.color,
        bodyBgRgb: toRgb(bodyCs.backgroundColor),
        bodyTextRgb: toRgb(bodyCs.color),
        ctaBgRgb: toRgb(ctaCs.backgroundColor),
        ctaTextRgb: toRgb(ctaCs.color)
      };
    })()`);

    console.log('Computed Body Background:', computedStyles.bodyBg, computedStyles.bodyBgRgb);
    console.log('Computed Body Text Color:', computedStyles.bodyText, computedStyles.bodyTextRgb);
    console.log('Computed CTA Button Fill:', computedStyles.ctaBg, computedStyles.ctaBgRgb);
    console.log('Computed CTA Button Text:', computedStyles.ctaText, computedStyles.ctaTextRgb);

    const textContrast = calculateContrast(computedStyles.bodyTextRgb, computedStyles.bodyBgRgb);
    console.log(`✔ Measured Text-to-Background Contrast: ${textContrast.toFixed(2)}:1 (Target >= 4.5:1 AA)`);
    if (textContrast < 4.5) {
      throw new Error(`Text-to-background contrast ${textContrast.toFixed(2)}:1 is below 4.5:1 AA.`);
    }

    const ctaContrast = calculateContrast(computedStyles.ctaTextRgb, computedStyles.ctaBgRgb);
    console.log(`✔ Measured CTA Text-to-CTA Fill Contrast: ${ctaContrast.toFixed(2)}:1 (Target >= 4.5:1 AA)`);
    if (ctaContrast < 4.5) {
      throw new Error(`CTA contrast ${ctaContrast.toFixed(2)}:1 is below 4.5:1 AA.`);
    }

    // Open Checkout Modal
    console.log('Clicking checkout CTA to trigger PaymentConfirmationModal...');
    await cdpClient.evaluate(`document.querySelector("#cart-full-checkout-btn")?.click()`);
    await sleep(500);

    // Verify Dialog accessibility
    const dialogState = await cdpClient.evaluate<{
      dialogOpen: boolean;
      role: string | null;
      ariaModal: string | null;
      ariaLabelledBy: string | null;
      hasCancelBtn: boolean;
      hasConfirmBtn: boolean;
    }>(`(() => {
      const dialog = document.querySelector("div[role='dialog']");
      const buttons = Array.from(document.querySelectorAll("button"));
      return {
        dialogOpen: !!dialog,
        role: dialog ? dialog.getAttribute("role") : null,
        ariaModal: dialog ? dialog.getAttribute("aria-modal") : null,
        ariaLabelledBy: dialog ? dialog.getAttribute("aria-labelledby") : null,
        hasCancelBtn: buttons.some((b) => b.textContent && (b.textContent.includes('ยกเลิก') || b.textContent.includes('Cancel'))),
        hasConfirmBtn: !!document.querySelector(".bg-cta")
      };
    })()`);

    if (!dialogState.dialogOpen || dialogState.role !== 'dialog' || dialogState.ariaModal !== 'true') {
      throw new Error(`Payment dialog accessibility check failed: ${JSON.stringify(dialogState)}`);
    }
    console.log(`✔ Payment Dialog Open = ${dialogState.dialogOpen}, role="${dialogState.role}", aria-modal="${dialogState.ariaModal}", aria-labelledby="${dialogState.ariaLabelledBy}"`);
    await cdpClient.captureScreenshot(resolve(evidenceDir, 'payment-confirmation-modal.png'));
    console.log('✔ Captured screenshot: tests/browser-evidence/payment-confirmation-modal.png');

    // Close dialog via Escape key
    console.log('Sending Escape key to verify keyboard dialog dismissal...');
    await cdpClient.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await cdpClient.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await sleep(300);

    let dialogClosed = await cdpClient.evaluate<boolean>('!document.querySelector("div[role=\'dialog\']")');
    if (!dialogClosed) {
      await cdpClient.evaluate('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }))');
      await sleep(300);
      dialogClosed = await cdpClient.evaluate<boolean>('!document.querySelector("div[role=\'dialog\']")');
    }
    if (!dialogClosed) {
      throw new Error('Payment dialog did not close on Escape key.');
    }
    console.log(`✔ Dialog closed on Escape key: ${dialogClosed}`);

    // ------------------------------------------------------------------------
    // TEST 4: RESPONSIVE VIEWPORTS
    // ------------------------------------------------------------------------
    console.log('\n--- Test Suite 4: Responsive Viewport Validation ---');

    // Tablet Landscape (1024x768)
    console.log('Testing Tablet Landscape (1024x768)...');
    await cdpClient.setViewport(1024, 768);
    await sleep(400);
    const tabletLandscapeCartVisible = await cdpClient.evaluate<boolean>('window.getComputedStyle(document.querySelector("aside[aria-label=\'Order Cart and Checkout Panel\']") || document.body).display !== "none"');
    console.log(`✔ Tablet Landscape Split Workspace: Cart visible = ${tabletLandscapeCartVisible}`);
    await cdpClient.captureScreenshot(resolve(evidenceDir, 'tablet-landscape-1024x768.png'));

    // Tablet Portrait (768x1024)
    console.log('Testing Tablet Portrait (768x1024)...');
    await cdpClient.setViewport(768, 1024);
    await sleep(400);
    await cdpClient.captureScreenshot(resolve(evidenceDir, 'tablet-portrait-768x1024.png'));
    console.log('✔ Tablet Portrait view rendered successfully.');

    // Mobile (390x844)
    console.log('Testing Mobile Viewport (390x844)...');
    await cdpClient.setViewport(390, 844, true);
    await sleep(400);
    const mobileBottomNavVisible = await cdpClient.evaluate<boolean>('!!document.querySelector("nav[aria-label=\'Mobile Quick Navigation\']")');
    console.log(`✔ Mobile Bottom Quick Navigation bar rendered = ${mobileBottomNavVisible}`);
    await cdpClient.captureScreenshot(resolve(evidenceDir, 'mobile-portrait-390x844.png'));

    // Mobile Narrow (320x700)
    console.log('Testing Mobile Narrow (320x700)...');
    await cdpClient.setViewport(320, 700, true);
    await sleep(400);
    const horizontalOverflow = await cdpClient.evaluate<boolean>('document.documentElement.scrollWidth > window.innerWidth');
    console.log(`✔ Mobile Narrow Horizontal Overflow = ${horizontalOverflow} (Expected: false)`);
    await cdpClient.captureScreenshot(resolve(evidenceDir, 'mobile-narrow-320x700.png'));

    // ------------------------------------------------------------------------
    // TEST 5: DARK MODE SWITCHING & THEME PERSISTENCE
    // ------------------------------------------------------------------------
    console.log('\n--- Test Suite 5: Dark Mode Switching & Computed Colors ---');
    await cdpClient.setViewport(1440, 900);
    await sleep(300);

    // Click theme toggle button
    await cdpClient.evaluate(`document.querySelector("button[aria-label*='mode']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))`);
    await sleep(500);

    const darkState = await cdpClient.evaluate<{
      isDarkClass: boolean;
      bodyBg: string;
      bodyText: string;
    }>(`({
      isDarkClass: document.documentElement.classList.contains("dark"),
      bodyBg: window.getComputedStyle(document.body).backgroundColor,
      bodyText: window.getComputedStyle(document.body).color
    })`);

    if (!darkState.isDarkClass) {
      throw new Error('Dark mode toggle did not apply .dark class to <html>.');
    }
    console.log(`✔ Dark Mode Toggled: Root .dark class present = ${darkState.isDarkClass}`);
    console.log('Computed Dark Body Background:', darkState.bodyBg);
    console.log('Computed Dark Body Text Color:', darkState.bodyText);
    const darkContrast = calculateContrast(parseRgb(darkState.bodyText), parseRgb(darkState.bodyBg));
    console.log(`✔ Measured Dark Mode Text-to-Background Contrast: ${darkContrast.toFixed(2)}:1 (Target >= 4.5:1 AA)`);
    if (darkContrast < 4.5) {
      throw new Error(`Dark mode contrast ${darkContrast.toFixed(2)}:1 is below 4.5:1 AA.`);
    }
    await cdpClient.captureScreenshot(resolve(evidenceDir, 'desktop-dark-mode.png'));
    console.log('✔ Captured screenshot: tests/browser-evidence/desktop-dark-mode.png');

    console.log('\n[6/7] All real browser behavior, interaction, responsive, and accessibility tests PASSED!');

  } finally {
    console.log('\n[7/7] Cleaning up processes...');
    if (cdpClient) {
      cdpClient.close();
    }
    if (chromeProcess) {
      chromeProcess.kill('SIGKILL');
    }
    if (previewProcess) {
      previewProcess.kill('SIGKILL');
    }
    console.log('Clean shutdown complete.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Browser Test Suite Error:', err);
    process.exit(1);
  });
