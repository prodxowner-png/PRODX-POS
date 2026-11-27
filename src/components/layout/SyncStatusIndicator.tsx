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
  X,
  ChevronDown,
  Layers,
  Database,
  ArrowRight,
  GitMerge,
  CloudUpload,
} from 'lucide-react';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { SyncVisualLogPanel } from '../sync/SyncVisualLogPanel';

export type SyncState = 'online' | 'syncing' | 'offline';

export interface SyncStatusIndicatorProps {
  className?: string;
  showDetailsOnHover?: boolean;
}

export const SyncStatusIndicator: React.FC<SyncStatusIndicatorProps> = ({
  className = '',
}) => {
  const {
    isOnline,
    isSimulatedOffline,
    toggleSimulatedOffline,
    outbox,
    pendingCount,
    syncedCount,
    failedCount,
    isSyncing,
    lastSyncedAt,
    triggerSync,
    clearSyncedItems,
    openSyncActivity,
  } = useOffline();

  const { language } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [isLogPanelOpen, setIsLogPanelOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Determine current sync state
  const syncState: SyncState = !isOnline
    ? 'offline'
    : isSyncing
    ? 'syncing'
    : 'online';

  // Handle outside click & escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const formatTime = (isoString?: string | null) => {
    if (!isoString) return language === 'th' ? 'ยังไม่มีการซิงก์' : 'Never';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  const getStatusLabel = () => {
    switch (syncState) {
      case 'offline':
        if (isSimulatedOffline) {
          return language === 'th' ? 'ออฟไลน์ (จำลอง)' : 'Offline (Sim)';
        }
        return language === 'th' ? 'ออฟไลน์' : 'Offline';
      case 'syncing':
        return language === 'th' ? 'กำลังซิงก์...' : 'Syncing...';
      case 'online':
      default:
        return language === 'th' ? 'ออนไลน์' : 'Online';
    }
  };

  const getTaskTypeLabel = (type: string) => {
    switch (type) {
      case 'order_transaction':
        return language === 'th' ? 'คำสั่งซื้อหน้าร้าน' : 'POS Order Transaction';
      case 'shift_movement':
        return language === 'th' ? 'การบันทึกกะ/ลิ้นชัก' : 'Shift Float Event';
      case 'stock_adjustment':
        return language === 'th' ? 'การปรับปรุงสต็อก' : 'Inventory Adjustment';
      default:
        return type.replace(/_/g, ' ');
    }
  };

  return (
    <div className={`relative inline-flex items-center select-none ${className}`} ref={dropdownRef}>
      {/* Subtle Navigation Bar Status Trigger */}
      <button
        type="button"
        id="sync-status-indicator"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title={
          syncState === 'offline'
            ? language === 'th'
              ? 'โหมดออฟไลน์: บันทึกรายการลงใน Outbox บนเครื่องอัตโนมัติ (คลิกเพื่อดูรายละเอียด)'
              : 'Offline Mode: Transactions queued locally in browser outbox (Click for details)'
            : syncState === 'syncing'
            ? language === 'th'
              ? 'กำลังส่งข้อมูลที่ค้างอยู่ขึ้นเซิร์ฟเวอร์...'
              : 'Syncing: Sending queued transactions to server...'
            : pendingCount > 0
            ? language === 'th'
              ? `ออนไลน์ · มี ${pendingCount} รายการรอการส่งข้อมูล (คลิกเพื่อดูรายละเอียด)`
              : `Online · ${pendingCount} items queued for sync (Click for details)`
            : language === 'th'
            ? 'ออนไลน์และข้อมูลซิงก์สมบูรณ์ (คลิกเพื่อดูสถานะระบบ)'
            : 'Online & Fully Synchronized (Click for details)'
        }
        className={`group relative flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 min-h-[36px] sm:min-h-[44px] rounded-xl border text-xs font-semibold transition-all duration-300 ease-in-out cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          syncState === 'offline'
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15 animate-pulse'
            : syncState === 'syncing'
            ? 'border-blue-500/60 bg-blue-500/20 text-blue-700 dark:text-blue-300 shadow-lg shadow-blue-500/10 animate-pulse'
            : 'border-border/80 bg-background/80 hover:bg-background text-text/80 hover:border-border hover:text-text'
        }`}
      >
        {/* State Indicator Icon / Dot */}
        <div className="flex items-center justify-center shrink-0">
          {syncState === 'offline' ? (
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0 animate-ping" />
              <WifiOff className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 transition-transform duration-300 scale-110" />
            </div>
          ) : syncState === 'syncing' ? (
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 animate-ping" />
              <RefreshCw className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 animate-spin shrink-0 transition-transform duration-300 scale-110" />
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <Wifi className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 transition-transform duration-300" />
            </div>
          )}
        </div>

        {/* State Label */}
        <span className="text-xs font-semibold leading-none hidden min-[400px]:inline">
          {getStatusLabel()}
        </span>

        {/* Pending Outbox Count Pill (if any pending items exist) */}
        {pendingCount > 0 && (
          <span
            id="sync-status-pending-pill"
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono tabular-nums font-bold leading-none ${
              syncState === 'offline'
                ? 'bg-amber-500/20 text-amber-800 dark:text-amber-200 border border-amber-500/30'
                : syncState === 'syncing'
                ? 'bg-blue-500/20 text-blue-700 dark:text-blue-200 border border-blue-500/30'
                : 'bg-primary/15 text-primary border border-primary/25'
            }`}
            title={`${pendingCount} pending task(s)`}
          >
            {pendingCount}
          </span>
        )}

        <ChevronDown
          className={`h-3 w-3 text-brand-text-secondary transition-transform duration-150 shrink-0 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Interactive Diagnostics Popover */}
      {isOpen && (
        <div
          id="sync-status-popover"
          role="dialog"
          aria-label={language === 'th' ? 'สถานะการเชื่อมต่อและคลังข้อมูลออฟไลน์' : 'Offline-First Sync Status'}
          className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-2xl border border-border border-crisp bg-card shadow-xl p-4 z-50 animate-in fade-in zoom-in-95 duration-150 text-text"
        >
          {/* Popover Header */}
          <div className="flex items-center justify-between pb-3 border-b border-border border-crisp">
            <div className="flex items-center gap-2">
              <div
                className={`p-1.5 rounded-lg shrink-0 ${
                  syncState === 'offline'
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    : syncState === 'syncing'
                    ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                    : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {syncState === 'offline' ? (
                  <WifiOff className="h-4 w-4" />
                ) : syncState === 'syncing' ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Wifi className="h-4 w-4" />
                )}
              </div>
              <div>
                <div className="text-xs font-bold text-text flex items-center gap-1.5">
                  <span>{language === 'th' ? 'สถานะการซิงก์ข้อมูล Outbox' : 'Offline-First Sync Status'}</span>
                </div>
                <div className="text-[10px] text-brand-text-secondary font-mono tabular-nums">
                  PRODX Local Resilience Engine
                </div>
              </div>
            </div>

            <button
              type="button"
              id="sync-status-popover-close-btn"
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-lg text-brand-text-secondary hover:text-text hover:bg-background cursor-pointer transition-colors"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Current State Diagnostic Banner */}
          <div className="mt-3">
            {syncState === 'offline' ? (
              <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200 text-xs">
                <div className="flex items-center gap-1.5 font-bold mb-1">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>
                    {isSimulatedOffline
                      ? (language === 'th' ? 'เปิดโหมดจำลองออฟไลน์' : 'Offline Mode Active (Simulated)')
                      : (language === 'th' ? 'ขาดการเชื่อมต่ออินเทอร์เน็ต' : 'Offline Mode Active')}
                  </span>
                </div>
                <p className="text-[11px] text-amber-800 dark:text-amber-300/90 leading-relaxed">
                  {language === 'th'
                    ? 'รายการคำสั่งซื้อและการปรับปรุงสต็อกทั้งหมดจะถูกบันทึกในแคชเครื่อง (LocalStorage Outbox) ด้วยสถานะ pending_sync_offline โดยอัตโนมัติ และจะส่งขึ้นเซิร์ฟเวอร์ทันทีเมื่อออนไลน์'
                    : 'Transactions are safely stored in the local outbox. They will automatically synchronize once connectivity is restored.'}
                </p>
              </div>
            ) : syncState === 'syncing' ? (
              <div className="p-3 rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-900 dark:text-blue-200 text-xs">
                <div className="flex items-center gap-1.5 font-bold mb-1">
                  <RefreshCw className="h-4 w-4 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
                  <span>
                    {language === 'th' ? 'กำลังซิงก์ข้อมูลขึ้นระบบ...' : 'Synchronizing Outbox with Server...'}
                  </span>
                </div>
                <p className="text-[11px] text-blue-800 dark:text-blue-300/90 leading-relaxed">
                  {language === 'th'
                    ? 'กำลังส่งต่อคำสั่งซื้อที่บันทึกไว้ในแคชเครื่องไปยังเซิร์ฟเวอร์และบันทึกหมายเลขยืนยัน'
                    : 'Authoritatively committing local outbox records to central server records.'}
                </p>
              </div>
            ) : (
              <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200 text-xs">
                <div className="flex items-center gap-1.5 font-bold mb-0.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>{language === 'th' ? 'ระบบออนไลน์และซิงก์เรียบร้อย' : 'Online & Fully Synchronized'}</span>
                </div>
                <p className="text-[11px] text-emerald-800 dark:text-emerald-300/90">
                  {language === 'th'
                    ? 'การเชื่อมต่อกับเซิร์ฟเวอร์ปกติ ทุกรายการล่าสุดถูกบันทึกสมบูรณ์'
                    : 'Server connection is healthy. All transactions are committed to the database.'}
                </p>
              </div>
            )}
          </div>

          {/* Sync Stats Grid */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="p-2 rounded-xl bg-background/80 border border-border text-center">
              <div className="text-[10px] font-semibold text-text/60 uppercase">
                {language === 'th' ? 'รอซิงก์' : 'Queued'}
              </div>
              <div className={`text-sm sm:text-base font-black font-mono tabular-nums mt-0.5 ${pendingCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-text/80'}`}>
                {pendingCount}
              </div>
            </div>

            <div className="p-2 rounded-xl bg-background/80 border border-border text-center">
              <div className="text-[10px] font-semibold text-text/60 uppercase">
                {language === 'th' ? 'ซิงก์สำเร็จ' : 'Synced'}
              </div>
              <div className="text-sm sm:text-base font-black font-mono tabular-nums mt-0.5 text-emerald-600 dark:text-emerald-400">
                {syncedCount}
              </div>
            </div>

            <div className="p-2 rounded-xl bg-background/80 border border-border text-center">
              <div className="text-[10px] font-semibold text-text/60 uppercase">
                {language === 'th' ? 'ซิงก์ล่าสุด' : 'Last Sync'}
              </div>
              <div className="text-xs font-bold font-mono tabular-nums mt-1 text-text/80 truncate" title={formatTime(lastSyncedAt)}>
                {formatTime(lastSyncedAt)}
              </div>
            </div>
          </div>

          {/* Outbox Tasks Mini-List (if any) */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-text/70 uppercase tracking-wide flex items-center gap-1">
                <Layers className="h-3.5 w-3.5 text-brand-text-secondary" />
                <span>{language === 'th' ? 'รายการใน Outbox' : 'Recent Outbox Queue'}</span>
              </span>
              {syncedCount > 0 && (
                <button
                  type="button"
                  id="sync-status-clear-synced-btn"
                  onClick={clearSyncedItems}
                  className="text-[10px] text-text/60 hover:text-text underline cursor-pointer"
                >
                  {language === 'th' ? 'ล้างที่ซิงก์แล้ว' : 'Clear Synced'}
                </button>
              )}
            </div>

            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-0.5 text-xs">
              {outbox.length === 0 ? (
                <div className="py-3 text-center rounded-xl bg-background/40 border border-dashed border-border text-brand-text-secondary text-[11px]">
                  {language === 'th' ? 'ไม่มีรายการค้างใน Outbox' : 'Outbox is clear. All transactions synced.'}
                </div>
              ) : (
                outbox.slice(0, 5).map((item) => (
                  <div
                    key={item.id}
                    className="p-2 rounded-lg border border-border bg-background/50 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-text text-[11px] truncate">
                        {getTaskTypeLabel(item.type)}
                      </div>
                      <div className="text-[10px] text-brand-text-secondary font-mono tabular-nums truncate">
                        {item.idempotencyKey.slice(0, 14)}... · {formatTime(item.createdAt)}
                      </div>
                    </div>
                    <Badge
                      variant={
                        item.syncState === 'synced'
                          ? 'success'
                          : item.syncState === 'failed'
                          ? 'danger'
                          : item.syncState === 'syncing'
                          ? 'primary'
                          : 'warning'
                      }
                      size="sm"
                    >
                      {item.syncState}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Action Footer Controls */}
          <div className="mt-3.5 pt-3 border-t border-border border-crisp flex items-center justify-between gap-2">
            <Button
              id="sync-status-toggle-offline-btn"
              size="sm"
              variant={isSimulatedOffline ? 'primary' : 'outline'}
              onClick={toggleSimulatedOffline}
              className="flex-1 text-xs"
            >
              {isSimulatedOffline
                ? (language === 'th' ? 'กลับสู่ออนไลน์' : 'Go Online')
                : (language === 'th' ? 'จำลองออฟไลน์' : 'Simulate Offline')}
            </Button>

            <Button
              id="sync-status-trigger-sync-btn"
              size="sm"
              variant="primary"
              onClick={() => triggerSync()}
              disabled={!isOnline || pendingCount === 0 || isSyncing}
              isLoading={isSyncing}
              leftIcon={<RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />}
              className="flex-1 text-xs font-semibold"
            >
              {language === 'th' ? 'ซิงก์ข้อมูลทันที' : 'Sync Now'}
            </Button>
          </div>

          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              openSyncActivity();
            }}
            className="w-full mt-2.5 py-2 px-3 rounded-xl bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer active:scale-95"
          >
            <CloudUpload className="w-3.5 h-3.5" />
            <span>{language === 'th' ? 'เปิด Sync Activity Panel (ประวัติการซิงก์)' : 'Open Sync Activity Panel (Full Log)'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              setIsLogPanelOpen(true);
            }}
            className="w-full mt-1.5 py-2 px-3 rounded-xl bg-background hover:bg-card border border-border border-crisp text-text/80 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <GitMerge className="w-3.5 h-3.5" />
            {language === 'th' ? 'ดูประวัติข้อขัดแย้งเชิงลึก (Conflict Log)' : 'Open Conflict Resolution Log'}
          </button>
        </div>
      )}

      <SyncVisualLogPanel isOpen={isLogPanelOpen} onClose={() => setIsLogPanelOpen(false)} />
    </div>
  );
};

// Export as ConnectivityBadge as well for backward-compatibility
export const ConnectivityBadge = SyncStatusIndicator;
