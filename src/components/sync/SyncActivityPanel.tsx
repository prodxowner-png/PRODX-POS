import React, { useState, useMemo, useEffect } from 'react';
import {
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Wifi,
  WifiOff,
  Clock,
  Database,
  CloudUpload,
  CloudDownload,
  ArrowRight,
  ArrowUpRight,
  X,
  Search,
  Filter,
  ShieldCheck,
  Activity,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Trash2,
  Zap,
  HardDrive,
  Layers,
  Server,
  Terminal,
  FileJson,
} from 'lucide-react';
import { useOffline, SyncActivityEvent } from '../../context/OfflineContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { getZIndexClass } from '../../utils/ZIndexManager';

export interface SyncActivityPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export type SyncActivityFilter =
  | 'all'
  | 'success'
  | 'failed'
  | 'in_progress'
  | 'order_transaction'
  | 'shift_movement'
  | 'stock_adjustment'
  | 'heartbeat_ping';

export const SyncActivityPanel: React.FC<SyncActivityPanelProps> = ({ isOpen, onClose }) => {
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
    syncLatencyMs,
    syncLatencyQuality,
    avgSyncLatencyMs,
    triggerSync,
    clearSyncedItems,
    syncActivityHistory,
    clearSyncActivityHistory,
  } = useOffline();

  const { language } = useLanguage();
  const { addToast } = useToast();

  const [filter, setFilter] = useState<SyncActivityFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Copy helper
  const handleCopy = (text: string, label: string) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      setCopiedKey(text);
      addToast({
        title: language === 'th' ? 'คัดลอกสำเร็จ' : 'Copied to Clipboard',
        message: `${label}: ${text}`,
        type: 'info',
        durationMs: 2500,
      });
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  // Export logs as JSON
  const handleExportJson = () => {
    try {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(syncActivityHistory, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `prodx-sync-activity-${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();

      addToast({
        title: language === 'th' ? 'ส่งออกข้อมูลสำเร็จ' : 'Export Succeeded',
        message: language === 'th' ? 'ดาวน์โหลดไฟล์ Sync Activity Log (JSON) เรียบร้อย' : 'Downloaded Sync Activity Log (JSON)',
        type: 'success',
      });
    } catch {
      addToast({
        title: language === 'th' ? 'การส่งออกล้มเหลว' : 'Export Failed',
        message: 'Unable to export JSON',
        type: 'error',
      });
    }
  };

  // Filtered & Searched events
  const filteredEvents = useMemo(() => {
    return syncActivityHistory.filter((item) => {
      // Filter tab
      if (filter === 'success' && item.status !== 'success') return false;
      if (filter === 'failed' && item.status !== 'failed') return false;
      if (filter === 'in_progress' && item.status !== 'in_progress') return false;
      if (
        filter === 'order_transaction' ||
        filter === 'shift_movement' ||
        filter === 'stock_adjustment' ||
        filter === 'heartbeat_ping'
      ) {
        if (item.eventType !== filter) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchSummary = item.summary?.toLowerCase().includes(query);
        const matchName = item.entityName?.toLowerCase().includes(query);
        const matchId = item.id?.toLowerCase().includes(query);
        const matchEntityId = item.entityId?.toLowerCase().includes(query);
        const matchIdem = item.idempotencyKey?.toLowerCase().includes(query);
        const matchError = item.errorMessage?.toLowerCase().includes(query);
        const matchServerId = item.serverConfirmedId?.toLowerCase().includes(query);
        return matchSummary || matchName || matchId || matchEntityId || matchIdem || matchError || matchServerId;
      }

      return true;
    });
  }, [syncActivityHistory, filter, searchQuery]);

  // Statistics calculation
  const totalEvents = syncActivityHistory.length;
  const successCount = syncActivityHistory.filter((e) => e.status === 'success').length;
  const failedEventsCount = syncActivityHistory.filter((e) => e.status === 'failed').length;
  const successRate = totalEvents > 0 ? ((successCount / totalEvents) * 100).toFixed(1) : '100';

  const formatDateTime = (iso?: string | null) => {
    if (!iso) return '-';
    try {
      const d = new Date(iso);
      return d.toLocaleString(language === 'th' ? 'th-TH' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const formatTimeOnly = (iso?: string | null) => {
    if (!iso) return '-';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 ${getZIndexClass('modal')} bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 lg:p-6 animate-in fade-in duration-150 select-none`}
      onClick={onClose}
    >
      <div
        className="bg-card text-text w-full max-w-5xl rounded-3xl border border-border border-crisp shadow-2xl flex flex-col overflow-hidden max-h-[92vh] h-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ========================================================================= */}
        {/* PANEL HEADER */}
        {/* ========================================================================= */}
        <div className="px-5 py-4 sm:px-6 sm:py-5 border-b border-border border-crisp bg-card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 shadow-xs">
              <CloudUpload className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold tracking-tight">
                  {language === 'th' ? 'Sync Activity' : 'Sync Activity'}
                </h2>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  Local Cache ↔ Cloud DB
                </span>
              </div>
              <p className="text-xs text-text/60 mt-0.5 leading-relaxed">
                {language === 'th'
                  ? 'ตรวจสอบประวัติกิจกรรมการซิงก์ข้อมูลระหว่าง Local POS Cache (IndexedDB) และ Cloud PostgreSQL พร้อมเวลาสำเร็จ/ล้มเหลว'
                  : 'Real-time telemetry and audit trail of data synchronization between local POS cache and cloud database.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            {/* Manual Sync Trigger */}
            <button
              type="button"
              onClick={() => triggerSync()}
              disabled={isSyncing || !isOnline}
              className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer"
              title="สั่งรันการซิงก์ข้อมูลคิวออฟไลน์ทันที"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? (language === 'th' ? 'กำลังซิงก์...' : 'Syncing...') : (language === 'th' ? 'ซิงก์ทันที' : 'Sync Now')}</span>
            </button>

            {/* Simulate Offline Mode Toggle */}
            <button
              type="button"
              onClick={toggleSimulatedOffline}
              className={`flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl border border-border border-crisp text-xs font-semibold transition-all cursor-pointer active:scale-95 ${
                isSimulatedOffline
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400 font-bold'
                  : 'bg-background hover:bg-card text-text/70 hover:text-text'
              }`}
              title="จำลองสถานการณ์ตัดการเชื่อมต่อเครือข่าย เพื่อทดสอบการบันทึกลง Local Cache"
            >
              {isSimulatedOffline ? <WifiOff className="w-3.5 h-3.5 text-rose-500" /> : <Wifi className="w-3.5 h-3.5 text-emerald-500" />}
              <span className="hidden md:inline">
                {isSimulatedOffline ? (language === 'th' ? 'ปิดจำลองออฟไลน์' : 'Exit Sim Offline') : (language === 'th' ? 'จำลองออฟไลน์' : 'Sim Offline')}
              </span>
            </button>

            {/* Export JSON */}
            <button
              type="button"
              onClick={handleExportJson}
              className="p-2 min-h-[40px] min-w-[40px] rounded-xl border border-border border-crisp bg-background hover:bg-card text-text/70 hover:text-text transition-colors flex items-center justify-center cursor-pointer"
              title={language === 'th' ? 'ส่งออกบันทึกเป็น JSON' : 'Export Activity as JSON'}
            >
              <Download className="w-4 h-4" />
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-2 min-h-[40px] min-w-[40px] rounded-xl border border-border border-crisp bg-background hover:bg-card text-text/70 hover:text-text transition-colors flex items-center justify-center cursor-pointer"
              aria-label="Close Sync Activity Panel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* STATS OVERVIEW CARDS */}
        {/* ========================================================================= */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 sm:gap-3 p-4 sm:px-6 bg-background/50 border-b border-border border-crisp text-xs shrink-0">
          {/* 1. Connection & Cloud State */}
          <div className="bg-card p-3 rounded-2xl border border-border border-crisp shadow-xs">
            <div className="text-[10px] font-bold text-brand-text-secondary uppercase tracking-wider flex items-center justify-between">
              <span>{language === 'th' ? 'สถานะคลาวด์' : 'Cloud Link'}</span>
              <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            </div>
            <div className="text-sm font-bold text-text mt-1 flex items-center gap-1.5">
              {isOnline ? (
                <>
                  <Wifi className="w-4 h-4 text-emerald-500" />
                  <span>{isSimulatedOffline ? (language === 'th' ? 'จำลองออฟไลน์' : 'Sim Offline') : (language === 'th' ? 'ออนไลน์สด' : 'Live Cloud')}</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-rose-500" />
                  <span className="text-rose-600 dark:text-rose-400">{language === 'th' ? 'ออฟไลน์' : 'Offline'}</span>
                </>
              )}
            </div>
            <div className="text-[10px] text-brand-text-secondary mt-0.5 truncate">
              {syncLatencyMs !== null ? `${syncLatencyMs} ms (${syncLatencyQuality})` : (language === 'th' ? 'ไม่เชื่อมต่อ' : 'Disconnected')}
            </div>
          </div>

          {/* 2. Local POS Cache (Outbox Queue) */}
          <div className="bg-card p-3 rounded-2xl border border-border border-crisp shadow-xs">
            <div className="text-[10px] font-bold text-brand-text-secondary uppercase tracking-wider flex items-center justify-between">
              <span>{language === 'th' ? 'Local POS Cache' : 'Local Cache'}</span>
              <HardDrive className="w-3.5 h-3.5 text-brand-text-secondary" />
            </div>
            <div className="text-sm font-bold text-text mt-1 flex items-center gap-1.5">
              <Database className="w-4 h-4 text-brand-text-accent" />
              <span>{outbox.length} {language === 'th' ? 'รายการในแคช' : 'Cached Items'}</span>
            </div>
            <div className="text-[10px] text-brand-text-secondary mt-0.5 flex items-center gap-1">
              <span className={pendingCount > 0 ? 'text-amber-600 dark:text-amber-400 font-bold' : ''}>
                {pendingCount} {language === 'th' ? 'รอส่ง' : 'pending'}
              </span>
              <span>•</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-bold">{syncedCount} {language === 'th' ? 'สำเร็จ' : 'synced'}</span>
            </div>
          </div>

          {/* 3. Success Rate */}
          <div className="bg-card p-3 rounded-2xl border border-border border-crisp shadow-xs">
            <div className="text-[10px] font-bold text-brand-text-secondary uppercase tracking-wider flex items-center justify-between">
              <span>{language === 'th' ? 'อัตราสำเร็จ' : 'Success Rate'}</span>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            </div>
            <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              <span>{successRate}%</span>
            </div>
            <div className="text-[10px] text-brand-text-secondary mt-0.5">
              {successCount} / {totalEvents} {language === 'th' ? 'เหตุการณ์สำเร็จ' : 'events confirmed'}
            </div>
          </div>

          {/* 4. Failed / Issues */}
          <div className="bg-card p-3 rounded-2xl border border-border border-crisp shadow-xs">
            <div className="text-[10px] font-bold text-brand-text-secondary uppercase tracking-wider flex items-center justify-between">
              <span>{language === 'th' ? 'ข้อขัดข้อง / รอซ้ำ' : 'Failed / Retries'}</span>
              <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
            </div>
            <div className={`text-sm font-bold mt-1 flex items-center gap-1.5 ${failedEventsCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-text'}`}>
              <AlertCircle className="w-4 h-4 text-rose-500" />
              <span>{failedEventsCount} {language === 'th' ? 'รายการขัดข้อง' : 'failed'}</span>
            </div>
            <div className="text-[10px] text-brand-text-secondary mt-0.5">
              {failedCount > 0 ? `${failedCount} รายการใน Outbox กำลังรอ Replay` : (language === 'th' ? 'ไม่มีข้อผิดพลาดค้าง' : 'Zero unhandled errors')}
            </div>
          </div>

          {/* 5. Last Sync Cycle */}
          <div className="col-span-2 md:col-span-1 bg-card p-3 rounded-2xl border border-border border-crisp shadow-xs">
            <div className="text-[10px] font-bold text-brand-text-secondary uppercase tracking-wider flex items-center justify-between">
              <span>{language === 'th' ? 'ซิงก์ล่าสุด' : 'Last Synced'}</span>
              <Clock className="w-3.5 h-3.5 text-brand-text-secondary" />
            </div>
            <div className="text-sm font-bold text-text mt-1 truncate">
              {formatTimeOnly(lastSyncedAt)}
            </div>
            <div className="text-[10px] text-brand-text-secondary mt-0.5 truncate">
              {avgSyncLatencyMs > 0 ? `Avg Latency: ${avgSyncLatencyMs} ms` : 'Authoritative Cloud Heartbeat'}
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* FILTER TABS & SEARCH BAR */}
        {/* ========================================================================= */}
        <div className="p-3 sm:px-6 border-b border-border border-crisp bg-card flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shrink-0">
          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {[
              { id: 'all', label: language === 'th' ? 'ทั้งหมด' : 'All', count: totalEvents },
              { id: 'success', label: language === 'th' ? 'สำเร็จ' : 'Success', count: successCount },
              { id: 'failed', label: language === 'th' ? 'ล้มเหลว' : 'Failed', count: failedEventsCount },
              { id: 'order_transaction', label: language === 'th' ? 'คำสั่งซื้อ' : 'Orders', count: syncActivityHistory.filter(e => e.eventType === 'order_transaction').length },
              { id: 'shift_movement', label: language === 'th' ? 'กะ/เงินสด' : 'Shifts', count: syncActivityHistory.filter(e => e.eventType === 'shift_movement').length },
              { id: 'stock_adjustment', label: language === 'th' ? 'สต็อก' : 'Inventory', count: syncActivityHistory.filter(e => e.eventType === 'stock_adjustment').length },
              { id: 'heartbeat_ping', label: 'Ping / HB', count: syncActivityHistory.filter(e => e.eventType === 'heartbeat_ping').length },
            ].map((tab) => {
              const isActive = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id as SyncActivityFilter)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-all cursor-pointer ${
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'bg-background hover:bg-card border border-border border-crisp text-text/70 hover:text-text'
                  }`}
                >
                  {tab.label} <span className="opacity-75 font-mono tabular-nums text-[11px]">({tab.count})</span>
                </button>
              );
            })}
          </div>

          {/* Search Box */}
          <div className="relative min-w-[220px] sm:w-64">
            <Search className="w-3.5 h-3.5 text-brand-text-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={language === 'th' ? 'ค้นหา Order ID, SKU, Idempotency...' : 'Search by ID, Key, Error...'}
              className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-background border border-border border-crisp text-xs text-text placeholder:text-brand-text-secondary focus:outline-none focus:border-primary transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-brand-text-secondary hover:text-text p-0.5 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* TIMELINE LIST OF SYNCHRONIZATION EVENTS */}
        {/* ========================================================================= */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-3.5 bg-background/30">
          {filteredEvents.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 rounded-3xl bg-background border border-border border-crisp flex items-center justify-center text-brand-text-secondary mb-3">
                <Filter className="w-7 h-7" />
              </div>
              <h4 className="text-sm font-bold text-text">
                {language === 'th' ? 'ไม่พบประวัติกิจกรรมการซิงก์ที่ตรงกับเงื่อนไข' : 'No sync activity matches your criteria'}
              </h4>
              <p className="text-xs text-text/60 mt-1 max-w-sm">
                {language === 'th'
                  ? 'ลองล้างคำค้นหาหรือเปลี่ยนแท็บการกรองเพื่อดูรายการกิจกรรมทั้งหมด'
                  : 'Try clearing the search query or selecting a different filter tab.'}
              </p>
              {(searchQuery || filter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setFilter('all');
                    setSearchQuery('');
                  }}
                  className="mt-4 px-3.5 py-1.5 rounded-xl bg-background border border-border border-crisp hover:bg-card text-xs font-semibold text-text transition-colors cursor-pointer"
                >
                  {language === 'th' ? 'รีเซ็ตการกรอง' : 'Reset Filters'}
                </button>
              )}
            </div>
          ) : (
            filteredEvents.map((event) => {
              const isExpanded = expandedEventId === event.id;
              const isSuccess = event.status === 'success';
              const isFailed = event.status === 'failed';
              const isInProgress = event.status === 'in_progress';

              return (
                <div
                  key={event.id}
                  className={`bg-card rounded-2xl border border-border border-crisp transition-all shadow-xs overflow-hidden ${
                    isFailed ? 'border-rose-500/40' : 'hover:border-primary/40'
                  }`}
                >
                  {/* Event Main Row */}
                  <div className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    {/* Left: Status icon & Event identity */}
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${
                          isSuccess
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                            : isFailed
                            ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
                            : 'bg-primary/10 text-brand-text-accent border-primary/20'
                        }`}
                      >
                        {isSuccess && <CheckCircle2 className="w-5 h-5" />}
                        {isFailed && <AlertCircle className="w-5 h-5" />}
                        {isInProgress && <RefreshCw className="w-5 h-5 animate-spin" />}
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-sm text-text leading-tight truncate">
                            {event.entityName || event.summary}
                          </span>
                          {/* Event Type Pill */}
                          <span className="text-[10px] font-mono tabular-nums font-semibold px-2 py-0.5 rounded-md bg-background border border-border border-crisp text-text/70 uppercase">
                            {event.eventType.replace('_', ' ')}
                          </span>
                          {/* Direction Indicator */}
                          <span className="text-[10px] font-semibold flex items-center gap-1 text-text/60 bg-background/80 px-2 py-0.5 rounded-md border border-border border-crisp">
                            {event.direction === 'local_to_cloud' ? (
                              <>
                                <CloudUpload className="w-3 h-3 text-brand-text-accent" />
                                <span>Local Cache ➔ Cloud DB</span>
                              </>
                            ) : event.direction === 'cloud_to_local' ? (
                              <>
                                <CloudDownload className="w-3 h-3 text-emerald-500" />
                                <span>Cloud DB ➔ Local Cache</span>
                              </>
                            ) : (
                              <>
                                <Activity className="w-3 h-3 text-amber-500" />
                                <span>Bidirectional Ping</span>
                              </>
                            )}
                          </span>
                        </div>

                        <p className="text-xs text-text/70 mt-1 leading-normal line-clamp-2">
                          {event.summary}
                        </p>

                        {event.details && (
                          <p className="text-[11px] text-brand-text-secondary mt-0.5 leading-normal">
                            {event.details}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Right: Timestamps & Key Metrics */}
                    <div className="flex flex-wrap items-center md:items-end justify-between md:justify-end gap-3 w-full md:w-auto shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-border border-crisp">
                      {/* Success / Failure Timestamps Display */}
                      <div className="flex flex-col md:items-end text-xs font-mono tabular-nums">
                        <div className="flex items-center gap-1 text-text/80 font-bold">
                          <Clock className="w-3 h-3 text-brand-text-secondary" />
                          <span>{formatTimeOnly(event.timestamp)}</span>
                          {event.completedAt && (
                            <>
                              <span className="text-brand-text-secondary">➔</span>
                              <span className={isSuccess ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                                {formatTimeOnly(event.completedAt)}
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-brand-text-secondary">
                          <span>{formatDateTime(event.timestamp)}</span>
                          {event.durationMs !== undefined && (
                            <span className="px-1.5 py-0.2 rounded bg-background border border-border border-crisp text-text/70 font-semibold">
                              {event.durationMs} ms
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Expand / Details Toggle */}
                      <div className="flex items-center gap-1.5">
                        {isFailed && (
                          <button
                            type="button"
                            onClick={() => triggerSync()}
                            className="px-2.5 py-1 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 text-[11px] font-bold transition-all cursor-pointer"
                            title="พยายามส่งรายการนี้ซ้ำขึ้น Cloud"
                          >
                            {language === 'th' ? 'ลองใหม่' : 'Retry'}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setExpandedEventId(isExpanded ? null : event.id)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-background hover:bg-card border border-border border-crisp text-xs font-semibold text-text/70 hover:text-text transition-all cursor-pointer"
                          aria-expanded={isExpanded}
                        >
                          <FileJson className="w-3.5 h-3.5 text-text/60" />
                          <span>{isExpanded ? (language === 'th' ? 'ย่อ' : 'Hide') : (language === 'th' ? 'ตรวจสอบ' : 'Inspect')}</span>
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Failure Error Message Callout */}
                  {isFailed && event.errorMessage && (
                    <div className="mx-4 mb-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2.5 font-mono tabular-nums">
                      <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="font-bold uppercase tracking-wider text-[10px]">
                          {language === 'th' ? 'สาเหตุข้อผิดพลาด (Failure Cause)' : 'Failure Cause'}:
                        </div>
                        <div className="mt-0.5">{event.errorMessage}</div>
                      </div>
                    </div>
                  )}

                  {/* Expanded Technical Inspection Details */}
                  {isExpanded && (
                    <div className="p-4 border-t border-border border-crisp bg-background/50 space-y-3 text-xs animate-in fade-in duration-100">
                      {/* Metadata Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-[11px] font-mono tabular-nums">
                        <div className="bg-card p-2.5 rounded-xl border border-border border-crisp">
                          <div className="text-brand-text-secondary text-[10px] uppercase">Event ID</div>
                          <div className="font-bold text-text truncate mt-0.5">{event.id}</div>
                        </div>

                        <div className="bg-card p-2.5 rounded-xl border border-border border-crisp">
                          <div className="text-brand-text-secondary text-[10px] uppercase">Idempotency Key</div>
                          <div className="font-bold text-text flex items-center justify-between mt-0.5">
                            <span className="truncate">{event.idempotencyKey || 'N/A'}</span>
                            {event.idempotencyKey && (
                              <button
                                type="button"
                                onClick={() => handleCopy(event.idempotencyKey!, 'Idempotency Key')}
                                className="text-brand-text-secondary hover:text-text p-0.5 ml-1 cursor-pointer shrink-0"
                                title="Copy Idempotency Key"
                              >
                                {copiedKey === event.idempotencyKey ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="bg-card p-2.5 rounded-xl border border-border border-crisp">
                          <div className="text-brand-text-secondary text-[10px] uppercase">Cloud Confirmed ID</div>
                          <div className="font-bold text-emerald-600 dark:text-emerald-400 truncate mt-0.5">
                            {event.serverConfirmedId || (isSuccess ? 'CONFIRMED' : 'PENDING_COMMIT')}
                          </div>
                        </div>

                        <div className="bg-card p-2.5 rounded-xl border border-border border-crisp">
                          <div className="text-brand-text-secondary text-[10px] uppercase">Attempts / Retries</div>
                          <div className="font-bold text-text mt-0.5">
                            {event.attempts || 1} {event.attempts && event.attempts > 1 ? '(Replayed)' : '(Single Shot)'}
                          </div>
                        </div>
                      </div>

                      {/* Payloads Inspection Tabs / Pre blocks */}
                      {(event.localPayload || event.cloudPayload) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                          {event.localPayload && (
                            <div>
                              <div className="text-[10px] font-bold text-text/60 uppercase tracking-wider mb-1 flex items-center gap-1">
                                <Database className="w-3 h-3 text-brand-text-accent" />
                                <span>Local Cache Payload (IndexedDB)</span>
                              </div>
                              <pre className="p-3 rounded-xl bg-card border border-border border-crisp text-[11px] font-mono tabular-nums text-text/80 overflow-x-auto max-h-48 leading-relaxed">
                                {JSON.stringify(event.localPayload, null, 2)}
                              </pre>
                            </div>
                          )}

                          {event.cloudPayload && (
                            <div>
                              <div className="text-[10px] font-bold text-text/60 uppercase tracking-wider mb-1 flex items-center gap-1">
                                <Server className="w-3 h-3 text-emerald-500" />
                                <span>Cloud Authoritative Response (PostgreSQL)</span>
                              </div>
                              <pre className="p-3 rounded-xl bg-card border border-border border-crisp text-[11px] font-mono tabular-nums text-text/80 overflow-x-auto max-h-48 leading-relaxed">
                                {JSON.stringify(event.cloudPayload, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ========================================================================= */}
        {/* PANEL FOOTER */}
        {/* ========================================================================= */}
        <div className="px-5 py-3.5 sm:px-6 border-t border-border border-crisp bg-card flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-2 text-text/60 font-mono tabular-nums text-[11px]">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Authoritative Persistence: PostgreSQL Transaction Boundaries & IndexedDB Resilience</span>
          </div>

          <div className="flex items-center gap-2">
            {outbox.some((i) => i.syncState === 'synced') && (
              <button
                type="button"
                onClick={clearSyncedItems}
                className="px-3 py-1.5 rounded-xl border border-border border-crisp hover:bg-background text-text/70 hover:text-text transition-colors cursor-pointer"
                title="ลบรายการที่ซิงก์สำเร็จแล้วออกจาก Outbox"
              >
                {language === 'th' ? 'ล้างคิวที่ซิงก์สำเร็จ' : 'Clear Synced Outbox'}
              </button>
            )}

            {syncActivityHistory.length > 0 && (
              <button
                type="button"
                onClick={clearSyncActivityHistory}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border border-crisp hover:bg-rose-500/10 hover:border-rose-500/30 text-text/70 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                title="ล้างบันทึกกิจกรรมทั้งหมด"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{language === 'th' ? 'ล้างบันทึก' : 'Clear Log'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl bg-primary text-primary-foreground font-bold hover:bg-primary/90 transition-all cursor-pointer shadow-xs active:scale-95"
            >
              {language === 'th' ? 'ปิดหน้าต่าง' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
