import React, { useState, useRef, useEffect } from 'react';
import { useOffline } from '../../context/OfflineContext';
import { useLanguage } from '../../context/LanguageContext';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  HardDrive,
  Clock,
  Activity,
  Layers,
  ChevronDown,
  Cloud,
  CloudOff,
  Database,
  ArrowRight,
} from 'lucide-react';
import { getZIndexClass } from '../../utils/ZIndexManager';

export interface ConnectivityStatusIndicatorProps {
  /** Optional custom CSS class */
  className?: string;
  /** Whether to show a compact dot only */
  compact?: boolean;
  /** Whether clicking opens the sync & connectivity drawer/popover */
  interactive?: boolean;
}

/**
 * ConnectivityStatusIndicator
 * 
 * Subtle, production-grade status indicator mounted in the app header (TopNav).
 * Consumes `OfflineProvider` context (`useOffline`) to display real-time
 * online/offline connectivity status to the POS cashier with zero layout shift
 * and graceful retail aesthetics.
 */
export const ConnectivityStatusIndicator: React.FC<ConnectivityStatusIndicatorProps> = ({
  className = '',
  compact = false,
  interactive = true,
}) => {
  const {
    isOnline,
    isSimulatedOffline,
    toggleSimulatedOffline,
    pendingCount,
    syncedCount,
    failedCount,
    isSyncing,
    lastSyncedAt,
    syncLatencyMs,
    syncLatencyQuality,
    triggerSync,
    openSyncActivity,
  } = useOffline();

  const { language } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const formatLastSync = (iso?: string | null) => {
    if (!iso) return language === 'th' ? 'ยังไม่ได้ซิงก์' : 'Never';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return iso;
    }
  };

  const getStatusText = () => {
    if (!isOnline) {
      if (isSimulatedOffline) {
        return language === 'th' ? 'ออฟไลน์ (จำลอง)' : 'Offline (Sim)';
      }
      return language === 'th' ? 'ออฟไลน์' : 'Offline';
    }
    if (isSyncing) {
      return language === 'th' ? 'กำลังซิงก์...' : 'Syncing...';
    }
    return language === 'th' ? 'ออนไลน์' : 'Online';
  };

  const getStatusAriaLabel = () => {
    if (!isOnline) {
      return language === 'th'
        ? `สถานะออฟไลน์: บันทึกรายการลงแคชในเครื่อง มี ${pendingCount} รายการรอการซิงก์`
        : `Offline status: Transactions saved to local cache, ${pendingCount} items queued for sync`;
    }
    if (isSyncing) {
      return language === 'th'
        ? 'กำลังส่งข้อมูลไปยังคลาวด์'
        : 'Synchronizing local outbox data to cloud database';
    }
    return language === 'th'
      ? 'สถานะออนไลน์: เชื่อมต่อเซิร์ฟเวอร์คลาวด์สมบูรณ์'
      : 'Online status: Connected to cloud server';
  };

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex items-center select-none ${className}`}
      data-testid="connectivity-status-indicator"
    >
      {/* Subtle Header Trigger */}
      <button
        type="button"
        id="header-connectivity-status-trigger"
        onClick={() => interactive && setIsOpen(!isOpen)}
        disabled={!interactive}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-live="polite"
        aria-label={getStatusAriaLabel()}
        title={getStatusAriaLabel()}
        className={`group relative flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 min-h-[38px] sm:min-h-[44px] rounded-xl border text-xs font-semibold transition-all duration-200 ease-out cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          !isOnline
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15'
            : isSyncing
            ? 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/15'
            : 'border-border/80 bg-background/80 hover:bg-background text-text/80 hover:text-text hover:border-border'
        }`}
      >
        {/* Subtle Status Light / Icon */}
        <span className="relative flex items-center justify-center shrink-0">
          {!isOnline ? (
            <span className="flex items-center gap-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
              </span>
              <WifiOff className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            </span>
          ) : isSyncing ? (
            <span className="flex items-center gap-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
              </span>
              <RefreshCw className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <Wifi className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            </span>
          )}
        </span>

        {/* Text Label: Subtle unboxed typography */}
        {!compact && (
          <span className="text-xs font-semibold leading-none hidden min-[400px]:inline">
            {getStatusText()}
          </span>
        )}

        {/* Pending Items Count Badge (Only visible when items are queued in outbox) */}
        {pendingCount > 0 && (
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold leading-none shrink-0 ${
              !isOnline
                ? 'bg-amber-500/20 text-amber-800 dark:text-amber-200 border border-amber-500/30'
                : 'bg-primary/15 text-primary border border-primary/25'
            }`}
            title={`${pendingCount} pending local transaction(s)`}
          >
            {pendingCount}
          </span>
        )}

        {/* Subtle drop chevron when interactive */}
        {interactive && (
          <ChevronDown
            className={`h-3 w-3 text-text/40 transition-transform duration-150 shrink-0 hidden sm:inline-block ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        )}
      </button>

      {/* Details Dropdown Popover */}
      {interactive && isOpen && (
        <div
          role="dialog"
          aria-label="Real-time connectivity details"
          className={`${getZIndexClass('dropdown')} absolute right-0 top-full mt-2 w-72 sm:w-80 rounded-2xl border border-border bg-card shadow-2xl p-3 animate-in fade-in zoom-in-95 duration-100 text-xs`}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  !isOnline ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'
                }`}
              />
              <span className="font-bold text-text">
                {!isOnline
                  ? language === 'th'
                    ? 'โหมดออฟไลน์ (Local Resilient)'
                    : 'Offline Mode (Local Resilient)'
                  : language === 'th'
                  ? 'เชื่อมต่อคลาวด์สมบูรณ์ (Online)'
                  : 'Cloud Connected (Online)'}
              </span>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${
                !isOnline
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                  : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
              }`}
            >
              {!isOnline ? 'OFFLINE' : 'LIVE'}
            </span>
          </div>

          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 gap-2 my-2">
            <div className="p-2 rounded-xl bg-background border border-border">
              <div className="text-[10px] text-text/60 font-semibold uppercase flex items-center gap-1">
                <Database className="h-3 w-3 text-primary" />
                <span>{language === 'th' ? 'รอการส่งข้อมูล' : 'Outbox Queue'}</span>
              </div>
              <div className="text-base font-bold font-mono text-text mt-0.5">
                {pendingCount}
                <span className="text-[10px] font-normal text-text/50 ml-1">
                  {language === 'th' ? 'รายการ' : 'items'}
                </span>
              </div>
            </div>

            <div className="p-2 rounded-xl bg-background border border-border">
              <div className="text-[10px] text-text/60 font-semibold uppercase flex items-center gap-1">
                <Activity className="h-3 w-3 text-emerald-500" />
                <span>{language === 'th' ? 'ความเร็วเครือข่าย' : 'Latency'}</span>
              </div>
              <div className="text-base font-bold font-mono text-text mt-0.5">
                {isOnline && syncLatencyMs !== null ? (
                  <span>
                    {syncLatencyMs}
                    <span className="text-[10px] font-normal text-text/50 ml-0.5">ms</span>
                  </span>
                ) : (
                  <span className="text-text/40 text-xs">N/A</span>
                )}
              </div>
            </div>
          </div>

          {/* Sync Metadata */}
          <div className="space-y-1.5 py-1 text-[11px] text-text/70 border-b border-border pb-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-text/60">
                <Clock className="h-3 w-3" />
                <span>{language === 'th' ? 'ซิงก์ล่าสุด:' : 'Last Synced:'}</span>
              </span>
              <span className="font-mono font-medium text-text">
                {formatLastSync(lastSyncedAt)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-text/60">
                <HardDrive className="h-3 w-3" />
                <span>{language === 'th' ? 'ซิงก์สำเร็จแล้ว:' : 'Synced Total:'}</span>
              </span>
              <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">
                {syncedCount}
              </span>
            </div>
            {failedCount > 0 && (
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-rose-500">
                  <AlertTriangle className="h-3 w-3" />
                  <span>{language === 'th' ? 'มีข้อผิดพลาด:' : 'Failed Retries:'}</span>
                </span>
                <span className="font-mono font-bold text-rose-500">
                  {failedCount}
                </span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex flex-col gap-1.5">
            {isOnline && (
              <button
                type="button"
                onClick={() => {
                  triggerSync();
                }}
                disabled={isSyncing}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-primary text-white font-bold text-xs shadow-xs hover:bg-primary-dark transition-all duration-150 cursor-pointer active:scale-95 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{language === 'th' ? 'ซิงก์ข้อมูลทันที' : 'Sync Outbox Now'}</span>
              </button>
            )}

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  openSyncActivity();
                }}
                className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl border border-border bg-background hover:bg-card text-text/80 text-[11px] font-semibold transition-all duration-150 cursor-pointer active:scale-95"
              >
                <Layers className="h-3 w-3 text-primary" />
                <span>{language === 'th' ? 'บันทึกการซิงก์' : 'Sync Log'}</span>
              </button>

              <button
                type="button"
                onClick={toggleSimulatedOffline}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl border text-[11px] font-semibold transition-all duration-150 cursor-pointer active:scale-95 ${
                  isSimulatedOffline
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold'
                    : 'border-border bg-background hover:bg-card text-text/70'
                }`}
                title="Toggle simulated network disruption to test offline resilience"
              >
                {isSimulatedOffline ? (
                  <>
                    <Cloud className="h-3 w-3 text-amber-500" />
                    <span>{language === 'th' ? 'ยกเลิกจำลอง' : 'End Sim'}</span>
                  </>
                ) : (
                  <>
                    <CloudOff className="h-3 w-3 text-text/50" />
                    <span>{language === 'th' ? 'จำลองออฟไลน์' : 'Sim Offline'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConnectivityStatusIndicator;
