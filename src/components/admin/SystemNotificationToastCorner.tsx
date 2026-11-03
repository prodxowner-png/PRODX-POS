import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock,
  CreditCard,
  Printer,
  Radio,
  RefreshCw,
  RotateCcw,
  Scan,
  ShieldAlert,
  WifiOff,
  Wrench,
  X,
  ZapOff,
} from 'lucide-react';
import { HardwarePeripheralStatus } from '../../types/hardware';
import {
  SystemNotificationListenerPayload,
  SystemNotificationToastItem,
  systemNotificationService,
} from '../../services/systemNotificationService';

export function useSystemNotifications(): SystemNotificationListenerPayload & {
  dismiss: (id: string) => void;
  clearAll: () => void;
  acknowledge: (id: string) => void;
} {
  const [state, setState] = useState<SystemNotificationListenerPayload>(() => ({
    notifications: systemNotificationService.getNotifications(),
    history: systemNotificationService.getHistory(),
  }));

  useEffect(() => {
    return systemNotificationService.subscribe((payload) => {
      setState(payload);
    });
  }, []);

  return {
    ...state,
    dismiss: (id: string) => systemNotificationService.dismissNotification(id),
    clearAll: () => systemNotificationService.clearAllNotifications(),
    acknowledge: (id: string) => systemNotificationService.acknowledgeNotification(id),
  };
}

export interface SystemNotificationToastCornerProps {
  onAutoReconnect?: (peripheral: HardwarePeripheralStatus) => void;
  onRemoteReboot?: (peripheral: HardwarePeripheralStatus) => void;
  onRunDiagnostics?: (peripheral: HardwarePeripheralStatus) => void;
  onClearError?: (peripheralId: string) => void;
  reconnectingPeripheralId?: string | null;
  rebootingPeripheralId?: string | null;
  diagnosingPeripheralId?: string | null;
}

export const SystemNotificationToastCorner: React.FC<SystemNotificationToastCornerProps> = ({
  onAutoReconnect,
  onRemoteReboot,
  onRunDiagnostics,
  onClearError,
  reconnectingPeripheralId,
  rebootingPeripheralId,
  diagnosingPeripheralId,
}) => {
  const { notifications, dismiss, clearAll } = useSystemNotifications();
  const [isHovered, setIsHovered] = useState(false);

  // Auto-dismiss timer per notification (pauses while user hovers on the corner toast stack)
  useEffect(() => {
    if (notifications.length === 0 || isHovered) return;

    const timers = notifications.map((item) => {
      const elapsed = Date.now() - item.createdAtMs;
      const remaining = Math.max(1500, item.durationMs - elapsed);
      return window.setTimeout(() => {
        systemNotificationService.dismissNotification(item.id);
      }, remaining);
    });

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [notifications, isHovered]);

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'printer':
        return <Printer className="w-4 h-4" />;
      case 'scanner':
        return <Scan className="w-4 h-4" />;
      case 'drawer':
        return <Banknote className="w-4 h-4" />;
      case 'edc':
        return <CreditCard className="w-4 h-4" />;
      default:
        return <Radio className="w-4 h-4" />;
    }
  };

  return (
    <div
      aria-live="assertive"
      aria-atomic="false"
      aria-label="System Hardware Connectivity Toast Notifications"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="fixed top-20 right-4 sm:right-6 z-50 flex flex-col gap-3 w-[calc(100vw-2rem)] sm:w-[420px] max-w-[420px] pointer-events-none"
    >
      <AnimatePresence mode="popLayout">
        {notifications.length > 1 && (
          <motion.div
            key="sys-notif-stack-header"
            initial={{ opacity: 0, y: -12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 450, damping: 30 }}
            className="pointer-events-auto flex items-center justify-between px-3.5 py-2 rounded-xl bg-slate-950/95 border border-slate-700/80 text-white shadow-xl backdrop-blur-md"
          >
            <div className="flex items-center gap-2 text-[11px] font-mono font-bold uppercase tracking-wider text-rose-300">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
              <span>SYSTEM NOTIFICATION SERVICE ({notifications.length} ACTIVE)</span>
            </div>
            <button
              type="button"
              onClick={clearAll}
              className="text-[11px] font-bold text-slate-300 hover:text-white underline cursor-pointer"
            >
              ปิดแจ้งเตือนทั้งหมด
            </button>
          </motion.div>
        )}

        {notifications.map((item) => {
          const isOffline = item.status === 'offline';
          const isError = item.status === 'error';
          const isRecovered = item.status === 'recovered';

          const isReconnecting = reconnectingPeripheralId === item.peripheralId;
          const isRebooting = rebootingPeripheralId === item.peripheralId;
          const isDiagnosing = diagnosingPeripheralId === item.peripheralId;

          const containerStyle = isOffline
            ? 'bg-slate-950/95 border-amber-500/80 text-white shadow-2xl shadow-amber-950/50 ring-1 ring-amber-400/40'
            : isError
            ? 'bg-rose-950/95 border-rose-500/80 text-white shadow-2xl shadow-rose-950/60 ring-1 ring-rose-400/50'
            : 'bg-emerald-950/95 border-emerald-500/80 text-white shadow-2xl shadow-emerald-950/50 ring-1 ring-emerald-400/40';

          const statusLabel = isOffline
            ? 'CONNECTIVITY: OFFLINE'
            : isError
            ? 'CONNECTIVITY: ERROR'
            : 'CONNECTIVITY: ONLINE';

          return (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, x: 90, y: -12, scale: 0.92 }}
              animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 110, scale: 0.9, transition: { duration: 0.2 } }}
              transition={{
                type: 'spring',
                stiffness: 420,
                damping: 28,
                mass: 0.85,
              }}
              drag="x"
              dragConstraints={{ left: 0, right: 140 }}
              onDragEnd={(_, info) => {
                if (info.offset.x > 80) {
                  dismiss(item.id);
                }
              }}
              className={`pointer-events-auto relative overflow-hidden rounded-2xl border p-4 backdrop-blur-md ${containerStyle}`}
            >
              {/* Top Status Metadata & Dismiss */}
              <div className="flex items-start justify-between gap-2.5">
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                      isOffline
                        ? 'bg-amber-500/20 border-amber-400/50 text-amber-300'
                        : isError
                        ? 'bg-rose-500/25 border-rose-400/50 text-rose-300 animate-pulse'
                        : 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                    }`}
                  >
                    {isOffline ? (
                      <WifiOff className="w-5 h-5 text-amber-400" />
                    ) : isError ? (
                      <ShieldAlert className="w-5 h-5 text-rose-400" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider">
                      <span
                        className={`font-black ${
                          isOffline
                            ? 'text-amber-300'
                            : isError
                            ? 'text-rose-300'
                            : 'text-emerald-300'
                        }`}
                      >
                        {statusLabel}
                      </span>
                      <span aria-hidden="true" className="opacity-40">
                        •
                      </span>
                      <span className="text-slate-300 inline-flex items-center gap-1">
                        {getCategoryIcon(item.category)}
                        {item.port}
                      </span>
                      <span aria-hidden="true" className="opacity-40">
                        •
                      </span>
                      <span className="text-slate-300 inline-flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {item.timestamp}
                      </span>
                    </div>

                    <h4 className="text-sm font-black text-white leading-snug mt-0.5">
                      {item.title}
                    </h4>

                    <p className="text-xs text-slate-200/90 leading-relaxed mt-1">
                      {item.message}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  aria-label="ปิดการแจ้งเตือน"
                  className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Actionable Admin Remediation Controls for Error / Offline */}
              {!isRecovered && (
                <div className="mt-3 pt-2.5 border-t border-white/15 flex flex-wrap items-center gap-2">
                  {item.peripheral && onAutoReconnect && (
                    <button
                      type="button"
                      onClick={() => onAutoReconnect(item.peripheral!)}
                      disabled={isReconnecting}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-black text-[11px] flex items-center gap-1 transition-all cursor-pointer active:scale-95"
                    >
                      <RefreshCw className={`w-3 h-3 ${isReconnecting ? 'animate-spin' : ''}`} />
                      <span>{isReconnecting ? 'กำลังเชื่อมต่อ...' : 'Auto-Reconnect'}</span>
                    </button>
                  )}

                  {item.peripheral && onRunDiagnostics && isError && (
                    <button
                      type="button"
                      onClick={() => onRunDiagnostics(item.peripheral!)}
                      disabled={isDiagnosing}
                      className="px-2.5 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white font-bold text-[11px] flex items-center gap-1 transition-all cursor-pointer active:scale-95"
                    >
                      <Wrench className={`w-3 h-3 ${isDiagnosing ? 'animate-spin' : ''}`} />
                      <span>{isDiagnosing ? 'กำลังซ่อมแซม...' : 'วินิจฉัย & ซ่อมแซม'}</span>
                    </button>
                  )}

                  {item.peripheral && onRemoteReboot && (
                    <button
                      type="button"
                      onClick={() => onRemoteReboot(item.peripheral!)}
                      disabled={isRebooting}
                      className="px-2.5 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-bold text-[11px] flex items-center gap-1 transition-all cursor-pointer active:scale-95"
                    >
                      <RotateCcw className={`w-3 h-3 ${isRebooting ? 'animate-spin' : ''}`} />
                      <span>{isRebooting ? 'กำลังรีบูต...' : 'รีบูตพอร์ต'}</span>
                    </button>
                  )}

                  {onClearError && (
                    <button
                      type="button"
                      onClick={() => {
                        onClearError(item.peripheralId);
                        dismiss(item.id);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-semibold text-[11px] border border-white/20 flex items-center gap-1 transition-all cursor-pointer active:scale-95 ml-auto"
                    >
                      <CheckCircle2 className="w-3 h-3 text-emerald-300" />
                      <span>กู้คืนออนไลน์</span>
                    </button>
                  )}
                </div>
              )}

              {/* Animated Framer-Motion Countdown Progress Bar */}
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30 overflow-hidden">
                <motion.div
                  initial={{ width: '100%' }}
                  animate={{ width: isHovered ? '100%' : '0%' }}
                  transition={{
                    duration: isHovered ? 0.2 : item.durationMs / 1000,
                    ease: 'linear',
                  }}
                  className={`h-full ${
                    isOffline
                      ? 'bg-amber-400'
                      : isError
                      ? 'bg-rose-400'
                      : 'bg-emerald-400'
                  }`}
                />
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
