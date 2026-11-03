import React from 'react';
import { useToast, ToastType } from '../../context/ToastContext';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  X,
  WifiOff,
  Wifi,
  Pin,
} from 'lucide-react';
import { CONNECTIVITY_TOAST_ID } from '../../services/toastNotificationService';

const toastIcons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />,
  error: <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />,
  info: <Info className="h-4 w-4 text-blue-500 shrink-0" />,
};

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="System Notifications"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[90] flex flex-col gap-2.5 max-w-sm w-[calc(100vw-2rem)] sm:w-full pointer-events-none"
    >
      {toasts.map((toast) => {
        const isConnectivityToast = toast.id === CONNECTIVITY_TOAST_ID;
        const isOfflineToast = isConnectivityToast && toast.type === 'warning';
        const isOnlineToast = isConnectivityToast && toast.type === 'success';

        return (
          <div
            key={toast.id}
            data-toast-id={toast.id}
            data-toast-persistent={toast.persistent ? 'true' : 'false'}
            className={`pointer-events-auto flex flex-col gap-2 p-3.5 rounded-xl border shadow-xl transition-all animate-in slide-in-from-bottom-2 duration-150 ${
              isOfflineToast
                ? 'border-amber-500/60 bg-slate-950 text-white ring-1 ring-amber-500/30'
                : isOnlineToast
                ? 'border-emerald-500/50 bg-slate-950 text-white ring-1 ring-emerald-500/30'
                : toast.persistent
                ? 'border-amber-500/50 bg-card text-text ring-1 ring-amber-500/20'
                : 'border-border border-crisp bg-card text-text'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                {isOfflineToast ? (
                  <div className="h-7 w-7 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
                    <WifiOff className="h-4 w-4 text-amber-400 animate-pulse" />
                  </div>
                ) : isOnlineToast ? (
                  <div className="h-7 w-7 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0">
                    <Wifi className="h-4 w-4 text-emerald-400" />
                  </div>
                ) : (
                  toastIcons[toast.type]
                )}
              </div>

              <div className="flex-1 min-w-0">
                {(toast.badge || toast.persistent) && (
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] font-black uppercase tracking-wider ${
                        isOfflineToast
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : isOnlineToast
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {toast.persistent && <Pin className="h-2.5 w-2.5" />}
                      {toast.badge || 'PERSISTENT ALERT'}
                    </span>
                  </div>
                )}

                <h5
                  className={`text-xs font-bold leading-tight ${
                    isOfflineToast || isOnlineToast ? 'text-white' : 'text-text'
                  }`}
                >
                  {toast.title}
                </h5>

                {toast.message && (
                  <p
                    className={`mt-1 text-xs leading-relaxed ${
                      isOfflineToast || isOnlineToast
                        ? 'text-slate-300'
                        : 'text-text/60'
                    }`}
                  >
                    {toast.message}
                  </p>
                )}
              </div>

              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => removeToast(toast.id)}
                className={`p-1 rounded transition-colors cursor-pointer shrink-0 ${
                  isOfflineToast || isOnlineToast
                    ? 'text-slate-400 hover:text-white hover:bg-white/10'
                    : 'text-text/50 hover:text-text/80 dark:hover:text-zinc-200'
                }`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {(toast.actionLabel || toast.secondaryActionLabel) && (
              <div className="flex items-center justify-end gap-2 pt-1.5 border-t border-white/10">
                {toast.secondaryActionLabel && toast.onSecondaryAction && (
                  <button
                    type="button"
                    onClick={() => toast.onSecondaryAction?.()}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white/10 hover:bg-white/20 text-slate-200 transition-colors cursor-pointer"
                  >
                    {toast.secondaryActionLabel}
                  </button>
                )}
                {toast.actionLabel && toast.onAction && (
                  <button
                    type="button"
                    onClick={() => toast.onAction?.()}
                    className={`px-3 py-1 rounded-lg text-[11px] font-black transition-colors cursor-pointer ${
                      isOfflineToast
                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                        : isOnlineToast
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                        : 'bg-primary hover:bg-primary-dark text-white'
                    }`}
                  >
                    {toast.actionLabel}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

