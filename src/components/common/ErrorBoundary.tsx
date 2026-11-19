import React from 'react';
import {
  AlertTriangle,
  RotateCcw,
  RefreshCw,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Terminal,
  ShieldAlert,
  Bug,
} from 'lucide-react';
import { ProdxLogo } from './ProdxLogo';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Name of the module or component wrapped (e.g., 'POS Checkout', 'Inventory', 'Audit') */
  moduleName?: string;
  /** Whether this boundary serves as the root application crash protector */
  isGlobal?: boolean;
  /** Custom fallback renderer */
  fallback?: React.ReactNode | ((error: Error, reset: () => void) => React.ReactNode);
  /** Callback fired when an error is caught */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  /** Callback fired when the user resets the boundary */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorName?: string;
  errorInfo: React.ErrorInfo | null;
  showDetails: boolean;
  copied: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorName: undefined,
      errorInfo: null,
      showDetails: false,
      copied: false,
    };
  }

  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    const candidateErrorName = error && typeof error.name === 'string' ? error.name : '';
    const errorName = /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(candidateErrorName)
      ? candidateErrorName
      : 'RenderError';
    return {
      hasError: true,
      error,
      errorName,
    };
  }

  public override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Persist and forward only bounded, non-sensitive metadata. Raw exception
    // messages/stacks can contain bearer tokens, SQL, URLs, or customer data.
    const candidateErrorName = typeof error.name === 'string' ? error.name : '';
    const errorName = /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(candidateErrorName)
      ? candidateErrorName
      : 'Error';
    const componentStack = typeof errorInfo.componentStack === 'string'
      ? errorInfo.componentStack.slice(0, 8000)
      : '';
    this.setState({ errorName, errorInfo: { componentStack } });

    // Optional consumers receive a sanitized exception, never the raw object.
    if (this.props.onError) {
      const safeError = new Error('An unexpected application rendering error occurred.');
      safeError.name = errorName;
      safeError.stack = undefined;
      this.props.onError(safeError, { componentStack });
    }

    // Raw exception messages and stacks are never persisted or logged.
    const safeUrl = typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : 'unknown';

    try {
      const crashLog = {
        id: `crash_${Date.now()}`,
        timestamp: new Date().toISOString(),
        moduleName: this.props.moduleName || 'Global Root',
        errorName,
        componentStack,
        url: safeUrl,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      };
      const existing = localStorage.getItem('prodx_crash_logs');
      const logs = existing ? JSON.parse(existing) : [];
      logs.unshift(crashLog);
      localStorage.setItem('prodx_crash_logs', JSON.stringify(logs.slice(0, 20)));
    } catch {
      // Ignore storage errors during crash recovery.
    }

    // Never write raw exception objects/messages to the production console.
    console.error(`[PRODX ErrorBoundary Caught in ${this.props.moduleName || 'Global'}]`, {
      errorName,
      componentStack,
    });
  }

  public resetBoundary = (): void => {
    if (this.props.onReset) {
      this.props.onReset();
    }
    this.setState({
      hasError: false,
      error: null,
      errorName: undefined,
      errorInfo: null,
      showDetails: false,
      copied: false,
    });
  };

  private copyErrorReport = (): void => {
    const { error, errorInfo } = this.state;
    const { moduleName } = this.props;

    const safeUrl = typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : 'unknown';
    const report = `[PRODX POS Error Diagnostic Report]
Time: ${new Date().toLocaleString()}
Module: ${moduleName || 'Global Application'}
Error: ${error && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(error.name) ? error.name : 'Error'} (message and stack withheld)

Component Stack:
${errorInfo?.componentStack || 'No component stack available'}

URL: ${safeUrl}
User Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'}`;

    navigator.clipboard.writeText(report).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2500);
    });
  };

  public override render(): React.ReactNode {
    const { hasError, error, errorInfo, showDetails, copied } = this.state;
    const { children, fallback, moduleName, isGlobal } = this.props;

    if (!hasError) {
      return children;
    }

    // Custom fallback support
    if (fallback) {
      if (typeof fallback === 'function') {
        const candidateErrorName = this.state.errorName || (error && typeof error.name === 'string' ? error.name : '');
        const safeErrorName = /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(candidateErrorName)
          ? candidateErrorName
          : 'RenderError';
        const safeError = new Error('An unexpected component render error occurred.');
        safeError.name = safeErrorName;
        safeError.stack = undefined;
        return fallback(safeError, this.resetBoundary);
      }
      return fallback;
    }

    // -------------------------------------------------------------
    // 1. GLOBAL / FULL-SCREEN ROOT CRASH UI
    // -------------------------------------------------------------
    if (isGlobal) {
      return (
        <div
          id="global-error-boundary-screen"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 sm:p-6 bg-background text-text font-sans selection:bg-primary selection:text-white overflow-y-auto"
        >
          {/* Subtle Ambient Background Glow */}
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 w-full max-w-lg flex flex-col items-center text-center">
            {/* PRODX Logo Monogram Header */}
            <div className="mb-4">
              <ProdxLogo variant="full" size="sm" showTagline={true} />
            </div>

            {/* Main Error Card */}
            <div
              id="global-error-card"
              className="w-full bg-card border border-rose-500/30 dark:border-rose-500/40 rounded-[28px] shadow-2xl p-6 sm:p-8 backdrop-blur-xl"
            >
              {/* Alert Badge */}
              <div className="flex items-center justify-center mb-3">
                <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/25 flex items-center justify-center text-rose-600 dark:text-rose-400 shadow-sm">
                  <ShieldAlert className="h-6 w-6" />
                </div>
              </div>

              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-text">
                Terminal Runtime Interrupted
              </h1>
              <p className="text-xs sm:text-sm text-text/70 mt-1">
                ระบบตรวจพบข้อผิดพลาดที่ไม่สามารถประมวลผลต่อได้ ข้อมูลธุรกรรมและแคชหลักถูกบันทึกไว้อย่างปลอดภัย
              </p>

              {/* Error Message Box */}
              <div className="mt-4 p-3 rounded-xl bg-rose-50/80 dark:bg-rose-950/40 border border-rose-200/80 dark:border-rose-900/50 text-left text-xs font-mono text-rose-800 dark:text-rose-300 break-words">
                <div className="flex items-center gap-1.5 font-bold mb-1 text-[11px] uppercase tracking-wider text-rose-900 dark:text-rose-200">
                  <AlertTriangle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                  <span>Exception Caught:</span>
                </div>
                <div>An unexpected application error occurred. Detailed error content is withheld to protect session and transaction data.</div>
              </div>

              {/* Primary Recovery Actions */}
              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  id="btn-error-reset-global"
                  type="button"
                  onClick={this.resetBoundary}
                  className="py-2.5 px-4 rounded-xl font-bold text-white text-xs bg-primary hover:bg-primary-dark active:scale-[0.99] shadow-md shadow-primary/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>ลองใหม่อีกครั้ง (Try Again)</span>
                </button>

                <button
                  id="btn-error-reload-page"
                  type="button"
                  onClick={() => window.location.reload()}
                  className="py-2.5 px-4 rounded-xl font-bold text-text text-xs bg-background hover:bg-background dark:hover:bg-background border border-border border-crisp active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>รีเฟรชระบบ (Reload POS)</span>
                </button>

                <p className="sm:col-span-2 text-[11px] text-text/60">
                  Reloading preserves local transaction and session data. Browser storage must not be cleared from this recovery screen.
                </p>
              </div>

              {/* Diagnostic Tools Toggle */}
              <div className="mt-4 pt-4 border-t border-border border-crisp flex items-center justify-between">
                <button
                  id="btn-toggle-diagnostics-global"
                  type="button"
                  onClick={() => this.setState({ showDetails: !showDetails })}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-text/60 hover:text-text dark:hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  <Terminal className="h-3.5 w-3.5 text-primary" />
                  <span>{showDetails ? 'ซ่อนข้อมูลเชิงลึก' : 'ดูข้อมูลเชิงลึก (Stack Trace)'}</span>
                  {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>

                <button
                  id="btn-copy-diagnostics-global"
                  type="button"
                  onClick={this.copyErrorReport}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-border border-crisp bg-background/50 dark:bg-white/5 hover:bg-background text-text/80 transition-colors cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-500" />
                      <span className="text-emerald-600 dark:text-emerald-400">คัดลอกแล้ว</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3 text-text/60" />
                      <span>คัดลอกรายงานบัค</span>
                    </>
                  )}
                </button>
              </div>

              {/* Collapsible Stack Trace */}
              {showDetails && (
                <div className="mt-3 p-3 rounded-xl bg-background text-zinc-200 text-left font-mono text-[10px] leading-relaxed max-h-48 overflow-y-auto border border-border animate-in fade-in duration-200">
                  <div className="text-amber-400 font-bold mb-1">// Component Stack Trace</div>
                  <pre className="whitespace-pre-wrap">{errorInfo?.componentStack || 'No component stack.'}</pre>
                  <div className="text-amber-400 font-bold mt-2 mb-1">// Error Stack</div>
                  <pre className="whitespace-pre-wrap">Detailed error stack is withheld to protect session and transaction data.</pre>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="mt-4 text-[10px] text-text/40 uppercase tracking-widest font-mono">
              PRODX POS ENTERPRISE · ISOLATED RECOVERY ENGINE
            </div>
          </div>
        </div>
      );
    }

    // -------------------------------------------------------------
    // 2. MODULAR SECTION / ROUTE CRASH UI (Inside POS Shell)
    // -------------------------------------------------------------
    return (
      <div
        id={`error-boundary-module-${moduleName || 'component'}`}
        className="w-full h-full min-h-[320px] flex items-center justify-center p-4 sm:p-6"
      >
        <div className="w-full max-w-md bg-card border border-amber-500/30 dark:border-amber-500/40 rounded-2xl shadow-xl p-5 sm:p-6 text-center">
          {/* Module Icon Badge */}
          <div className="flex items-center justify-center mb-2.5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center text-primary">
              <Bug className="h-5 w-5" />
            </div>
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10.5px] font-bold uppercase tracking-wider mb-2">
            <span>{moduleName || 'Module'} Encountered an Issue</span>
          </div>

          <h2 className="text-base sm:text-lg font-bold text-text">
            ส่วนการทำงานนี้เกิดข้อผิดพลาดชั่วคราว
          </h2>
          <p className="text-xs text-text/60 mt-0.5">
            โมดูลอื่นและหน้าขายหลัก (POS) ยังคงทำงานได้ตามปกติ คุณสามารถลองโหลดใหม่หรือสลับกลับหน้าขาย
          </p>

          {/* Error Message */}
          <div className="mt-3 p-2.5 rounded-xl bg-background border border-border border-crisp text-left text-[11px] font-mono text-text/80 break-words max-h-24 overflow-y-auto">
            An unexpected module error occurred. Detailed error content is withheld to protect session and transaction data.
          </div>

          {/* Action Buttons */}
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              id={`btn-reset-${moduleName || 'module'}`}
              type="button"
              onClick={this.resetBoundary}
              className="py-2 px-3.5 rounded-xl font-bold text-white text-xs bg-primary hover:bg-primary-dark active:scale-[0.99] shadow-sm shadow-primary/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>ลองใหม่อีกครั้ง</span>
            </button>

            <button
              id={`btn-copy-module-err-${moduleName || 'module'}`}
              type="button"
              onClick={this.copyErrorReport}
              className="py-2 px-3 rounded-xl font-semibold text-text/80 text-xs bg-background hover:bg-background dark:hover:bg-background border border-border border-crisp transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">คัดลอกแล้ว</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3 text-text/60" />
                  <span>คัดลอกข้อผิดพลาด</span>
                </>
              )}
            </button>
          </div>

          {/* Quick Toggle Details */}
          <div className="mt-3 pt-3 border-t border-border border-crisp">
            <button
              type="button"
              onClick={() => this.setState({ showDetails: !showDetails })}
              className="text-[10px] text-text/50 hover:text-text/70 dark:hover:text-text/60 transition-colors inline-flex items-center gap-1 cursor-pointer"
            >
              <span>{showDetails ? 'Hide technical logs' : 'Show technical logs'}</span>
              {showDetails ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
            </button>
            {showDetails && (
              <div className="mt-2 p-2 rounded-lg bg-background text-text/60 text-[9.5px] font-mono text-left max-h-32 overflow-y-auto leading-normal">
                <pre className="whitespace-pre-wrap">{errorInfo?.componentStack || 'Detailed error stack is withheld.'}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}

export interface GlobalErrorRecoveryProviderProps {
  children: React.ReactNode;
  moduleName?: string;
}

export const GlobalErrorRecoveryProvider: React.FC<GlobalErrorRecoveryProviderProps> = ({
  children,
  moduleName = 'PRODX POS Enterprise Recovery Engine',
}) => {
  return (
    <ErrorBoundary isGlobal={true} moduleName={moduleName}>
      {children}
    </ErrorBoundary>
  );
};
