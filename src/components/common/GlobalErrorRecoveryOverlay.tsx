/**
 * PRODX POS - Dedicated Global Error Recovery UI Component
 * 
 * Intercepts and visualizes critical failures (API timeouts, state corruption, network breaks)
 * in the PRODX-POS core loop, displaying live countdowns, auto-healing progress,
 * and emergency manual recovery workflows.
 */

import React, { useState } from 'react';
import {
  ShieldAlert,
  RotateCcw,
  RefreshCw,
  Terminal,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Zap,
  ChevronDown,
  ChevronUp,
  X,
  Database,
  Activity,
  Server,
  Sparkles,
  WifiOff,
  Cpu,
  Layers,
} from 'lucide-react';
import { useGlobalErrorRecovery, CriticalFailureType } from '../../context/GlobalErrorRecoveryProvider';
import { ProdxLogo } from './ProdxLogo';

export const GlobalErrorRecoveryOverlay: React.FC = () => {
  const {
    activeFailures,
    currentFailure,
    isRecovering,
    attemptAutoRecovery,
    abortAutoRecovery,
    dismissFailure,
    clearAllFailures,
    sanitizeAndRestoreState,
    simulateFailure,
    isOverlayOpen,
    setIsOverlayOpen,
    reloadPreservingTransactionData,
    recoveryHistory,
  } = useGlobalErrorRecovery();

  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showSimulators, setShowSimulators] = useState(false);
  const [showAuditLogs, setShowAuditLogs] = useState(false);
  const [sanitationMessage, setSanitationMessage] = useState<string | null>(null);

  if (!isOverlayOpen || !currentFailure) {
    return null;
  }

  const failure = currentFailure;

  const handleManualSanitize = () => {
    const res = sanitizeAndRestoreState('all');
    setSanitationMessage(res.message);
    setTimeout(() => setSanitationMessage(null), 4000);
  };

  const getFailureBadgeColor = (type: CriticalFailureType) => {
    switch (type) {
      case 'API_TIMEOUT':
        return 'bg-amber-500/15 border-amber-500/35 text-amber-600 dark:text-amber-400';
      case 'STATE_CORRUPTION':
        return 'bg-rose-500/15 border-rose-500/35 text-rose-600 dark:text-rose-400';
      case 'CIRCUIT_BREAKER':
        return 'bg-purple-500/15 border-purple-500/35 text-purple-600 dark:text-purple-400';
      case 'OUTBOX_DEADLOCK':
        return 'bg-indigo-500/15 border-indigo-500/35 text-indigo-600 dark:text-indigo-400';
      case 'HARDWARE_BUS_FAILURE':
        return 'bg-cyan-500/15 border-cyan-500/35 text-cyan-600 dark:text-cyan-400';
      case 'RUNTIME_CRASH':
      default:
        return 'bg-rose-500/15 border-rose-500/35 text-rose-600 dark:text-rose-400';
    }
  };

  const getFailureIcon = (type: CriticalFailureType) => {
    switch (type) {
      case 'API_TIMEOUT':
        return <Clock className="w-5 h-5 text-amber-500" />;
      case 'STATE_CORRUPTION':
        return <Layers className="w-5 h-5 text-rose-500" />;
      case 'CIRCUIT_BREAKER':
        return <WifiOff className="w-5 h-5 text-purple-500" />;
      case 'OUTBOX_DEADLOCK':
        return <Database className="w-5 h-5 text-indigo-500" />;
      case 'HARDWARE_BUS_FAILURE':
        return <Cpu className="w-5 h-5 text-cyan-500" />;
      case 'RUNTIME_CRASH':
      default:
        return <ShieldAlert className="w-5 h-5 text-rose-500" />;
    }
  };

  return (
    <div
      id="global-error-recovery-modal"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6 bg-background/80 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-modal-title"
    >
      {/* Background radial gradient glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-2xl bg-card border border-rose-500/40 rounded-3xl shadow-2xl overflow-hidden flex flex-col my-auto">
        {/* Top Accent Glowing Bar */}
        <div
          className={`h-1.5 w-full transition-all ${
            isRecovering
              ? 'bg-gradient-to-r from-indigo-500 via-cyan-400 to-indigo-600 animate-pulse'
              : failure.status === 'recovered'
              ? 'bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-600'
              : 'bg-gradient-to-r from-rose-500 via-amber-400 to-rose-600 animate-pulse'
          }`}
        />

        {/* Modal Header */}
        <div className="p-5 sm:p-6 pb-4 flex items-start justify-between gap-4 border-b border-border border-crisp bg-background/40">
          <div className="flex items-start gap-3.5">
            <div className="relative shrink-0">
              {/* CSS Pulse Ring */}
              {isRecovering ? (
                <span className="animate-ring-active absolute -inset-1 rounded-2xl bg-indigo-500/30 pointer-events-none" />
              ) : failure.status === 'recovered' ? (
                <span className="animate-ring-idle absolute -inset-1 rounded-2xl bg-emerald-500/30 pointer-events-none" />
              ) : (
                <span className="animate-ring-error absolute -inset-1 rounded-2xl bg-rose-500/30 pointer-events-none" />
              )}
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center relative z-10 border ${
                  isRecovering
                    ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-500 scale-105'
                    : failure.status === 'recovered'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-500'
                }`}
              >
                {getFailureIcon(failure.type)}
              </div>
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono uppercase tracking-wider border ${getFailureBadgeColor(
                    failure.type
                  )}`}
                >
                  <Activity className="w-3 h-3" />
                  {failure.type.replace(/_/g, ' ')}
                </span>
                <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-background border border-border border-crisp text-text/60">
                  MODULE: {failure.module.toUpperCase()}
                </span>
                {activeFailures.length > 1 && (
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-600 dark:text-rose-400 font-bold">
                    +{activeFailures.length - 1} อื่นๆ
                  </span>
                )}
              </div>
              <h2 id="recovery-modal-title" className="text-base sm:text-lg font-bold text-text leading-tight">
                {failure.title}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => dismissFailure(failure.id)}
              className="w-8 h-8 rounded-xl bg-background hover:bg-card border border-border border-crisp text-text/60 hover:text-text flex items-center justify-center transition-colors cursor-pointer"
              title="ปิดหน้าต่างนี้ (Dismiss Alert)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-4 max-h-[68vh] overflow-y-auto no-scrollbar">
          {/* Explanation Banner */}
          <div className="p-3.5 rounded-2xl bg-background/80 border border-border border-crisp text-xs text-text/80 leading-relaxed space-y-1">
            <div className="font-semibold text-text flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <span>ตรวจพบภาวะขัดข้องในวงรอบการทำงานของ POS (Core Loop Interception)</span>
            </div>
            <p className="text-text/70">
              {failure.type === 'RUNTIME_CRASH'
                ? 'A rendering error interrupted the application. Sensitive error details are withheld; local transaction data is preserved.'
                : failure.message}
            </p>
          </div>

          {/* Auto-Recovery Countdown & Execution Status Bar */}
          <div className="p-4 rounded-2xl bg-background border border-border border-crisp space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span
                    className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      isRecovering
                        ? 'animate-ring-active bg-indigo-400'
                        : failure.status === 'recovered'
                        ? 'animate-ring-idle bg-emerald-400'
                        : 'animate-ring-error bg-rose-500'
                    }`}
                  />
                  <span
                    className={`relative inline-flex rounded-full h-2 w-2 m-auto ${
                      isRecovering
                        ? 'animate-pulse-active bg-indigo-600'
                        : failure.status === 'recovered'
                        ? 'animate-pulse-idle bg-emerald-500'
                        : 'animate-pulse-error bg-rose-600'
                    }`}
                  />
                </span>

                <span className="font-bold text-text">
                  {isRecovering ? (
                    <span className="text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      กำลังดำเนินการกู้คืนระบบอัตโนมัติ (Executing Auto-Recovery)...
                    </span>
                  ) : failure.status === 'recovered' ? (
                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      กู้คืนระบบสำเร็จ! กลับสู่สภาวะปกติ (Recovered)
                    </span>
                  ) : failure.status === 'exhausted' ? (
                    <span className="text-rose-600 dark:text-rose-400">
                      พยายามกู้คืนครบ {failure.maxAttempts} ครั้งแล้ว — โปรดเลือกการแก้ไขด้วยตนเอง
                    </span>
                  ) : failure.status === 'aborted' ? (
                    <span className="text-amber-600 dark:text-amber-400">
                      ระงับการลองใหม่อัตโนมัติ (Auto-Retry Paused)
                    </span>
                  ) : (
                    <span>
                      จะพยายามกู้คืนอัตโนมัติในอีก{' '}
                      <strong className="text-indigo-600 dark:text-indigo-400 font-mono text-sm">
                        {failure.countdownSeconds ?? 0}s
                      </strong>{' '}
                      (ครั้งที่ {failure.autoRecoveryAttempt + 1} จาก {failure.maxAttempts})
                    </span>
                  )}
                </span>
              </div>

              <div className="text-[11px] font-mono text-text/50">
                ยุทธวิธี: <span className="font-bold text-text/80">{failure.recoveryStrategy}</span>
              </div>
            </div>

            {/* Countdown Progress Visual Bar */}
            {failure.countdownSeconds !== null && failure.countdownSeconds > 0 && !isRecovering && (
              <div className="w-full bg-card h-2 rounded-full overflow-hidden border border-border border-crisp">
                <div
                  className="bg-indigo-600 h-full rounded-full transition-all duration-1000 ease-linear"
                  style={{ width: `${Math.min(100, (failure.countdownSeconds / 3) * 100)}%` }}
                />
              </div>
            )}

            {/* Resolution Details Banner when recovered */}
            {failure.resolutionDetails && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-mono">
                <div className="font-bold mb-0.5 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Resolution Log:
                </div>
                <div>{failure.resolutionDetails}</div>
              </div>
            )}
          </div>

          {/* Sanitation feedback if triggered */}
          {sanitationMessage && (
            <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/25 text-indigo-600 dark:text-indigo-400 text-xs font-mono">
              <div className="font-bold mb-0.5">State Sanitation Report:</div>
              <div>{sanitationMessage}</div>
            </div>
          )}

          {/* Primary Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <button
              onClick={() => attemptAutoRecovery(failure.id)}
              disabled={isRecovering}
              className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.99] cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isRecovering ? 'animate-spin' : ''}`} />
              <span>{isRecovering ? 'กำลังกู้คืน...' : 'กู้คืนอัตโนมัติทันที (Auto-Recover Now)'}</span>
            </button>

            <button
              onClick={handleManualSanitize}
              disabled={isRecovering}
              className="w-full py-2.5 px-4 rounded-xl bg-background hover:bg-card border border-border border-crisp text-text/80 text-xs font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.99] cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>ชำระล้าง State ที่เสียหาย (Sanitize State)</span>
            </button>

            {failure.countdownSeconds !== null && (
              <button
                onClick={() => abortAutoRecovery(failure.id)}
                className="w-full py-2 px-3 rounded-xl bg-background hover:bg-card border border-border border-crisp text-text/70 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5 text-amber-500" />
                <span>ระงับการลองใหม่อัตโนมัติ (Pause Auto-Retry)</span>
              </button>
            )}

            <button
              onClick={reloadPreservingTransactionData}
              className="w-full py-2 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reload safely (preserve offline transactions)</span>
            </button>
          </div>

          {/* Collapsible Sections: Diagnostics, Simulator, Audit Logs */}
          <div className="space-y-2 pt-2 border-t border-border border-crisp">
            {/* Diagnostics Drawer */}
            <div className="rounded-xl border border-border border-crisp bg-background/50 overflow-hidden">
              <button
                onClick={() => setShowDiagnostics((prev) => !prev)}
                className="w-full p-3 flex items-center justify-between text-xs font-semibold text-text/70 hover:text-text cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-indigo-500" />
                  <span>ข้อมูลเชิงลึกทางเทคนิค (Technical Stack Trace & Diagnostics)</span>
                </span>
                {showDiagnostics ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {showDiagnostics && (
                <div className="p-3 border-t border-border border-crisp bg-card/60 text-[11px] font-mono space-y-2 text-text/80 max-h-48 overflow-y-auto no-scrollbar">
                  <div>
                    <span className="text-text/50">Failure ID:</span> {failure.id}
                  </div>
                  <div>
                    <span className="text-text/50">Timestamp:</span> {failure.timestamp}
                  </div>
                  {failure.contextData && (
                    <div>
                      <span className="text-text/50">Context Payload:</span>
                      <pre className="mt-1 p-2 rounded-lg bg-background border border-border border-crisp overflow-x-auto text-[10px]">
                        {JSON.stringify(failure.contextData, null, 2)}
                      </pre>
                    </div>
                  )}
                  {failure.errorStack && failure.type !== 'RUNTIME_CRASH' && (
                    <div>
                      <span className="text-text/50">Stack Trace:</span>
                      <pre className="mt-1 p-2 rounded-lg bg-background border border-border border-crisp overflow-x-auto text-[10px] text-rose-600 dark:text-rose-400">
                        {failure.errorStack}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Test Simulation Controls */}
            <div className="rounded-xl border border-border border-crisp bg-background/50 overflow-hidden">
              <button
                onClick={() => setShowSimulators((prev) => !prev)}
                className="w-full p-3 flex items-center justify-between text-xs font-semibold text-text/70 hover:text-text cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  <span>เครื่องมือจำลองความล้มเหลว (Failure Simulation Lab)</span>
                </span>
                {showSimulators ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {showSimulators && (
                <div className="p-3 border-t border-border border-crisp bg-card/60 space-y-2 text-xs">
                  <div className="text-[11px] text-text/60">
                    ทดสอบการทำงานของ Auto-Recovery Engine ด้วยการสร้างข้อผิดพลาดจำลอง:
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      onClick={() => simulateFailure('API_TIMEOUT')}
                      className="px-2.5 py-1.5 rounded-lg bg-background hover:bg-card border border-border border-crisp text-[11px] font-semibold text-text cursor-pointer"
                    >
                      API Timeout
                    </button>
                    <button
                      onClick={() => simulateFailure('STATE_CORRUPTION')}
                      className="px-2.5 py-1.5 rounded-lg bg-background hover:bg-card border border-border border-crisp text-[11px] font-semibold text-text cursor-pointer"
                    >
                      State Corruption
                    </button>
                    <button
                      onClick={() => simulateFailure('OUTBOX_DEADLOCK')}
                      className="px-2.5 py-1.5 rounded-lg bg-background hover:bg-card border border-border border-crisp text-[11px] font-semibold text-text cursor-pointer"
                    >
                      Outbox Deadlock
                    </button>
                    <button
                      onClick={() => simulateFailure('CIRCUIT_BREAKER')}
                      className="px-2.5 py-1.5 rounded-lg bg-background hover:bg-card border border-border border-crisp text-[11px] font-semibold text-text cursor-pointer"
                    >
                      Circuit Breaker
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Audit Log Drawer */}
            {recoveryHistory.length > 0 && (
              <div className="rounded-xl border border-border border-crisp bg-background/50 overflow-hidden">
                <button
                  onClick={() => setShowAuditLogs((prev) => !prev)}
                  className="w-full p-3 flex items-center justify-between text-xs font-semibold text-text/70 hover:text-text cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Server className="w-3.5 h-3.5 text-cyan-500" />
                    <span>ประวัติการกู้คืนระบบ ({recoveryHistory.length} รายการล่าสุด)</span>
                  </span>
                  {showAuditLogs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                {showAuditLogs && (
                  <div className="p-3 border-t border-border border-crisp bg-card/60 text-[11px] font-mono space-y-2 max-h-48 overflow-y-auto no-scrollbar">
                    {recoveryHistory.map((item) => (
                      <div
                        key={item.id}
                        className="p-2 rounded-lg bg-background border border-border border-crisp flex items-start justify-between gap-2"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                item.success ? 'bg-emerald-500' : 'bg-rose-500'
                              }`}
                            />
                            <span className="font-bold text-text">{item.type}</span>
                            <span className="text-[10px] text-text/50">({item.strategy})</span>
                          </div>
                          <div className="text-[10px] text-text/70 mt-0.5">{item.message}</div>
                        </div>
                        <div className="text-[10px] text-text/40 shrink-0 text-right">
                          <div>{item.durationMs}ms</div>
                          <div>{new Date(item.timestamp).toLocaleTimeString('th-TH')}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-background/70 border-t border-border border-crisp flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] font-mono text-text/50">
          <div className="flex items-center gap-2">
            <ProdxLogo variant="mark" size="sm" />
            <span>PRODX-POS Autonomous Emergency Recovery Loop</span>
          </div>
          <div>
            <button
              onClick={() => dismissFailure(failure.id)}
              className="text-text/70 hover:text-text hover:underline cursor-pointer"
            >
              ข้ามไปทำงานต่อในโหมดออฟไลน์ (Continue Offline)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
