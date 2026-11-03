import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownUp,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock,
  Cloud,
  CloudOff,
  Copy,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  Filter,
  HardDrive,
  HelpCircle,
  Info,
  Layers,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import { useOffline, SyncLatencyQuality, SyncLatencyRecord, SyncActivityEvent } from '../../context/OfflineContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import {
  firestoreSyncStatusService,
  AdminFirestoreSyncStatusSnapshot,
  PendingFirestoreWriteItem,
} from '../../services/firestoreSyncStatusService';
import { OutboxItem } from '../../domain/sync';

export interface OfflineBufferSyncMonitorProps {
  className?: string;
}

type QueueFilterTab = 'all' | 'pos_outbox' | 'admin_mutations' | 'failed_conflicts' | 'activity_log';

export const OfflineBufferSyncMonitor: React.FC<OfflineBufferSyncMonitorProps> = ({
  className = '',
}) => {
  const { language } = useLanguage();
  const { addToast } = useToast();
  const isThai = language === 'th';

  // POS Offline Outbox data from OfflineContext
  const {
    isOnline,
    isSimulatedOffline,
    outbox,
    pendingCount: posPendingCount,
    syncedCount: posSyncedCount,
    failedCount: posFailedCount,
    isSyncing: isPosSyncing,
    lastSyncedAt: posLastSyncedAt,
    syncLatencyMs,
    syncLatencyQuality,
    syncLatencyHistory,
    avgSyncLatencyMs,
    minSyncLatencyMs,
    maxSyncLatencyMs,
    isMeasuringLatency,
    measureSyncLatency,
    toggleSimulatedOffline,
    triggerSync: triggerPosSync,
    clearSyncedItems,
    queueOutboxItem,
    syncActivityHistory,
    currentConflict,
  } = useOffline();

  // Admin Firestore Sync Status data
  const [adminSyncSnapshot, setAdminSyncSnapshot] = useState<AdminFirestoreSyncStatusSnapshot>(() =>
    firestoreSyncStatusService.getSnapshot(),
  );

  const [activeTab, setActiveTab] = useState<QueueFilterTab>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [isFlushingAll, setIsFlushingAll] = useState<boolean>(false);
  const [relativeTime, setRelativeTime] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Subscribe to firestoreSyncStatusService
  useEffect(() => {
    const unsub = firestoreSyncStatusService.subscribe((snapshot) => {
      setAdminSyncSnapshot(snapshot);
    });
    return () => unsub();
  }, []);

  // Update relative time ticker every 5 seconds
  useEffect(() => {
    const updateRelative = () => {
      const targetTime = posLastSyncedAt || (adminSyncSnapshot.lastSyncedAt ? new Date(adminSyncSnapshot.lastSyncedAt).toISOString() : null);
      if (!targetTime) {
        setRelativeTime(isThai ? 'ยังไม่มีการซิงก์ในเซสชันนี้' : 'No sync recorded in session');
        return;
      }
      const syncTs = new Date(targetTime).getTime();
      const diffSec = Math.floor((Date.now() - syncTs) / 1000);
      if (diffSec < 10) {
        setRelativeTime(isThai ? 'เมื่อสักครู่นี้' : 'Just now');
      } else if (diffSec < 60) {
        setRelativeTime(isThai ? `${diffSec} วินาทีที่แล้ว` : `${diffSec}s ago`);
      } else {
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) {
          setRelativeTime(isThai ? `${diffMin} นาทีที่แล้ว` : `${diffMin}m ago`);
        } else {
          const diffHr = Math.floor(diffMin / 60);
          setRelativeTime(isThai ? `${diffHr} ชม. ที่แล้ว` : `${diffHr}h ago`);
        }
      }
    };

    updateRelative();
    const interval = setInterval(updateRelative, 5000);
    return () => clearInterval(interval);
  }, [posLastSyncedAt, adminSyncSnapshot.lastSyncedAt, isThai]);

  // Aggregated Queue counts
  const adminPendingCount = adminSyncSnapshot.FirestoreWriteQueueCount || 0;
  const totalPendingQueueSize = posPendingCount + adminPendingCount;
  const totalFailedCount = posFailedCount + adminSyncSnapshot.failedCount;
  const totalConflictsCount = (currentConflict ? 1 : 0) + adminSyncSnapshot.conflictCount;
  const isAnySyncing = isPosSyncing || adminSyncSnapshot.isSyncing || isFlushingAll;

  // Breakdown of POS outbox items by type
  const orderCount = useMemo(() => outbox.filter((i) => i.type === 'order_transaction').length, [outbox]);
  const shiftCount = useMemo(() => outbox.filter((i) => i.type === 'shift_movement').length, [outbox]);
  const stockCount = useMemo(() => outbox.filter((i) => i.type === 'stock_adjustment').length, [outbox]);

  // Handle Flush / Force Sync All
  const handleFlushAll = async () => {
    if (isAnySyncing) return;
    setIsFlushingAll(true);
    try {
      const promises: Promise<unknown>[] = [triggerPosSync()];
      if (adminPendingCount > 0) {
        promises.push(firestoreSyncStatusService.processPendingWriteQueue());
      }
      await Promise.all(promises);
      addToast({
        type: 'success',
        title: isThai ? 'ซิงก์คิว OfflineBuffer สำเร็จ' : 'Offline Buffer Sync Complete',
        message: isThai
          ? 'ข้อมูลคำสั่งซื้อและเอกสารคอนฟิกในแคช Local ทั้งหมดซิงก์ขึ้น Cloud เรียบร้อยแล้ว'
          : 'All pending local cache transactions and documents committed to cloud.',
        durationMs: 3500,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast({
        type: 'error',
        title: isThai ? 'การซิงก์ขัดข้อง' : 'Sync Failed',
        message: msg,
        durationMs: 4000,
      });
    } finally {
      setIsFlushingAll(false);
    }
  };

  // Handle Probe Latency Ping
  const handleMeasureLatency = async () => {
    try {
      const ms = await measureSyncLatency();
      addToast({
        type: ms !== null ? 'success' : 'warning',
        title: isThai ? 'ทดสอบ Round-Trip Latency สำเร็จ' : 'RTT Latency Measured',
        message: ms !== null
          ? isThai
            ? `ความเร็วตอบสนองเครือข่าย: ${ms} ms (${syncLatencyQuality.toUpperCase()})`
            : `Round-trip sync latency: ${ms} ms (${syncLatencyQuality.toUpperCase()})`
          : isThai
          ? 'โหมดออฟไลน์: ไม่สามารถวัด Latency ได้'
          : 'Offline mode: Unable to ping cloud.',
        durationMs: 3000,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast({
        type: 'error',
        title: isThai ? 'การวัดผลขัดข้อง' : 'Ping Failed',
        message: msg,
        durationMs: 3500,
      });
    }
  };

  // Handle Enqueue Test Item to verify offline queuing
  const handleEnqueueTestItem = async () => {
    const testId = `sim-${Date.now().toString().slice(-4)}`;
    try {
      await queueOutboxItem('stock_adjustment', `idem-test-${Date.now()}`, {
        sku: `SKU-SIM-${testId}`,
        delta: -1,
        reason: 'offline_buffer_simulation_test',
        timestamp: new Date().toISOString(),
      });
      addToast({
        type: 'info',
        title: isThai ? 'เพิ่มรายการทดสอบลง OfflineBuffer' : 'Test Transaction Queued',
        message: isThai
          ? `เพิ่มรายการตัดสต็อกจำลอง #${testId} ลงในแคช IndexedDB เรียบร้อย`
          : `Simulated stock delta #${testId} stored in local IndexedDB outbox.`,
        durationMs: 3500,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast({
        type: 'error',
        title: isThai ? 'บันทึกลง Buffer ไม่สำเร็จ' : 'Enqueue Failed',
        message: msg,
        durationMs: 3500,
      });
    }
  };

  // Copy Idempotency Key or ID helper
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filtered queue items
  const filteredPosItems = useMemo(() => {
    return outbox.filter((item) => {
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesKey = item.idempotencyKey.toLowerCase().includes(query);
        const matchesId = item.id.toLowerCase().includes(query);
        const matchesType = item.type.toLowerCase().includes(query);
        if (!matchesKey && !matchesId && !matchesType) return false;
      }
      return true;
    });
  }, [outbox, searchQuery]);

  const filteredAdminItems = useMemo(() => {
    return (adminSyncSnapshot.queue || []).filter((item) => {
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesDoc = item.documentId.toLowerCase().includes(query);
        const matchesEntity = item.entityName.toLowerCase().includes(query);
        const matchesCol = item.collection.toLowerCase().includes(query);
        if (!matchesDoc && !matchesEntity && !matchesCol) return false;
      }
      return true;
    });
  }, [adminSyncSnapshot.queue, searchQuery]);

  // Buffer fill percentage (against soft threshold 50 items)
  const bufferThreshold = 50;
  const bufferFillPct = Math.min(100, Math.round((totalPendingQueueSize / bufferThreshold) * 100));

  // Determine quality color and icon
  const getQualityBadge = (quality: SyncLatencyQuality) => {
    switch (quality) {
      case 'optimal':
        return { label: isThai ? 'สมบูรณ์มาก (<100ms)' : 'Optimal (<100ms)', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' };
      case 'good':
        return { label: isThai ? 'ดี (<250ms)' : 'Good (<250ms)', color: 'text-cyan-500 bg-cyan-500/10 border-cyan-500/20' };
      case 'moderate':
        return { label: isThai ? 'ปานกลาง (<500ms)' : 'Moderate (<500ms)', color: 'text-amber-500 bg-amber-500/10 border-amber-500/20' };
      case 'high':
      case 'poor':
        return { label: isThai ? 'ช้า (>500ms)' : 'High Latency (>500ms)', color: 'text-rose-500 bg-rose-500/10 border-rose-500/20' };
      case 'offline':
      default:
        return { label: isThai ? 'ออฟไลน์' : 'Offline', color: 'text-slate-400 bg-slate-500/10 border-slate-500/20' };
    }
  };

  const qualityBadge = getQualityBadge(syncLatencyQuality);

  return (
    <section
      aria-label="Offline Buffer and Sync Queue Telemetry"
      className={`bg-card border border-border border-crisp rounded-3xl p-5 sm:p-6 shadow-sm space-y-6 ${className}`}
    >
      {/* 1. Header & Connectivity Status Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-border border-crisp">
        <div className="flex items-start gap-3.5">
          <div
            className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border ${
              isOnline
                ? totalPendingQueueSize > 0
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-500'
            }`}
          >
            {isOnline ? (
              totalPendingQueueSize > 0 ? (
                <HardDrive className={`w-5 h-5 ${isAnySyncing ? 'animate-spin' : ''}`} />
              ) : (
                <Cloud className="w-5 h-5" />
              )
            ) : (
              <CloudOff className="w-5 h-5" />
            )}
          </div>

          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-wider">
              <span className="font-bold text-indigo-600 dark:text-indigo-400">
                OFFLINE BUFFER & RESILIENCE SYNC
              </span>
              <span aria-hidden="true" className="opacity-40">·</span>
              <span className="text-text/70">
                IndexedDB Outbox & Invariant Replay
              </span>
              <span aria-hidden="true" className="opacity-40">·</span>
              <span className={`inline-flex items-center gap-1 font-semibold ${isOnline ? 'text-emerald-500' : 'text-rose-500'}`}>
                {isOnline ? (
                  <>
                    <Wifi className="w-3 h-3" />
                    <span>{isSimulatedOffline ? 'Simulated Offline' : 'Live Online'}</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3 h-3" />
                    <span>Offline (Outbox Active)</span>
                  </>
                )}
              </span>
            </div>

            <h3 className="text-lg font-bold text-text flex items-center gap-2">
              <span>{isThai ? 'มอนิเตอร์คิวซิงก์ OfflineBuffer & สถานะการเชื่อมต่อ' : 'OfflineBuffer Sync Queue & Connectivity Health'}</span>
            </h3>

            <p className="text-xs text-text/60">
              {isThai
                ? 'ตรวจสอบคิวรอซิงก์ (Pending Outbox) ในแคชของอุปกรณ์, คำนวณความเร็ว Round-Trip Time (RTT) แบบเรียลไทม์ และป้องกันการสูญหายของธุรกรรม'
                : 'Real-time telemetry of durable local IndexedDB buffer, RTT round-trip latency, and idempotent replay status.'}
            </p>
          </div>
        </div>

        {/* Action Controls Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={toggleSimulatedOffline}
            className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 whitespace-nowrap ${
              isSimulatedOffline
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-500 hover:bg-rose-500/20'
                : 'bg-background hover:bg-accent border-border text-text/80'
            }`}
            title={isThai ? 'สลับโหมดจำลองออฟไลน์เพื่อทดสอบบัฟเฟอร์' : 'Toggle simulated offline mode'}
          >
            {isSimulatedOffline ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
            <span>{isSimulatedOffline ? (isThai ? 'ยกเลิกจำลองออฟไลน์' : 'Exit Offline Sim') : (isThai ? 'จำลองออฟไลน์' : 'Simulate Offline')}</span>
          </button>

          <button
            type="button"
            onClick={handleMeasureLatency}
            disabled={isMeasuringLatency || !isOnline}
            className="px-3 py-2 text-xs font-medium rounded-xl border border-border bg-background hover:bg-accent disabled:opacity-50 text-text/80 transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 whitespace-nowrap"
            title={isThai ? 'วัดความเร็วตอบสนองเครือข่าย (RTT)' : 'Ping RTT latency'}
          >
            <Activity className={`w-3.5 h-3.5 text-cyan-500 ${isMeasuringLatency ? 'animate-pulse' : ''}`} />
            <span>{isMeasuringLatency ? (isThai ? 'กำลังวัด...' : 'Pinging...') : (isThai ? 'วัด Latency' : 'Ping RTT')}</span>
          </button>

          <button
            type="button"
            onClick={handleEnqueueTestItem}
            className="px-3 py-2 text-xs font-medium rounded-xl border border-border bg-background hover:bg-accent text-text/80 transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 whitespace-nowrap"
            title={isThai ? 'เพิ่มรายการทดสอบลง OfflineBuffer' : 'Queue simulated stock adjustment'}
          >
            <Plus className="w-3.5 h-3.5 text-indigo-500" />
            <span>{isThai ? 'ทดสอบเข้าคิว' : 'Test Enqueue'}</span>
          </button>

          <button
            type="button"
            onClick={handleFlushAll}
            disabled={isAnySyncing || !isOnline}
            className="px-4 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-all flex items-center gap-2 cursor-pointer shadow-md shadow-indigo-600/20 active:scale-95 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isAnySyncing ? 'animate-spin' : ''}`} />
            <span>{isAnySyncing ? (isThai ? 'กำลังซิงก์...' : 'Syncing...') : (isThai ? 'ซิงก์คิวทันที' : 'Flush Buffer')}</span>
          </button>
        </div>
      </div>

      {/* 2. Key Telemetry Metrics Grid (4 Stat Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Queue Size */}
        <div className="bg-background/80 rounded-2xl p-4 border border-border border-crisp shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-text/60">
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              {isThai ? 'ขนาดคิวรอซิงก์ (Queue Size)' : 'Buffer Queue Size'}
            </span>
            <Layers className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-text font-mono tabular-nums">
              {totalPendingQueueSize}
            </span>
            <span className="text-xs font-medium text-text/60">
              {isThai ? 'รายการรอซิงก์' : 'items pending'}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-text/60 pt-1 border-t border-border/50">
            <span>POS: {posPendingCount}</span>
            <span aria-hidden="true">·</span>
            <span>Admin/Org: {adminPendingCount}</span>
            <span aria-hidden="true">·</span>
            <span className={totalPendingQueueSize === 0 ? 'text-emerald-500 font-semibold' : 'text-amber-500 font-semibold'}>
              {totalPendingQueueSize === 0 ? (isThai ? 'เคลียร์แล้ว' : 'Drained') : (isThai ? 'กำลังพักคิว' : 'Buffered')}
            </span>
          </div>
        </div>

        {/* Card 2: Connectivity & Latency Quality */}
        <div className="bg-background/80 rounded-2xl p-4 border border-border border-crisp shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-text/60">
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              {isThai ? 'ความเร็วเชื่อมต่อ (RTT Latency)' : 'RTT Network Latency'}
            </span>
            <Activity className="w-4 h-4 text-cyan-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-text font-mono tabular-nums">
              {isOnline ? (syncLatencyMs !== null ? `${syncLatencyMs} ms` : '—') : (isThai ? 'ออฟไลน์' : 'Offline')}
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-md font-semibold border ${qualityBadge.color}`}>
              {qualityBadge.label}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-text/60 pt-1 border-t border-border/50">
            <span>Avg: {avgSyncLatencyMs > 0 ? `${avgSyncLatencyMs}ms` : '—'}</span>
            <span aria-hidden="true">·</span>
            <span>Min: {minSyncLatencyMs > 0 ? `${minSyncLatencyMs}ms` : '—'}</span>
            <span aria-hidden="true">·</span>
            <span>Max: {maxSyncLatencyMs > 0 ? `${maxSyncLatencyMs}ms` : '—'}</span>
          </div>
        </div>

        {/* Card 3: Sync Integrity & Success Velocity */}
        <div className="bg-background/80 rounded-2xl p-4 border border-border border-crisp shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-text/60">
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              {isThai ? 'ธุรกรรมที่ซิงก์สำเร็จ (Committed)' : 'Committed to Cloud'}
            </span>
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">
              {posSyncedCount + (adminSyncSnapshot.totalSyncedCount || 0)}
            </span>
            <span className="text-xs font-medium text-text/60">
              {isThai ? 'ยืนยันบน Server' : 'server committed'}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-text/60 pt-1 border-t border-border/50">
            <span className={totalFailedCount > 0 ? 'text-rose-500 font-semibold' : 'text-text/60'}>
              {totalFailedCount} {isThai ? 'ผิดพลาด/รอรีไทร' : 'retrying'}
            </span>
            <span aria-hidden="true">·</span>
            <span className={totalConflictsCount > 0 ? 'text-amber-500 font-semibold' : 'text-text/60'}>
              {totalConflictsCount} {isThai ? 'ข้อขัดแย้ง' : 'conflicts'}
            </span>
          </div>
        </div>

        {/* Card 4: Last Authoritative Sync Cycle */}
        <div className="bg-background/80 rounded-2xl p-4 border border-border border-crisp shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-text/60">
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              {isThai ? 'รอบซิงก์ล่าสุด (Last Cycle)' : 'Last Sync Cycle'}
            </span>
            <Clock className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-text truncate">
              {relativeTime}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-text/60 pt-1 border-t border-border/50 font-mono">
            <span className="truncate">
              {posLastSyncedAt ? new Date(posLastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Never'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-emerald-500 font-semibold">
              {isOnline ? 'Heartbeat OK' : 'Outbox Retention'}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Visual Buffer Capacity & Category Composition Bar */}
      <div className="space-y-2 bg-background/50 p-4 rounded-2xl border border-border/80">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text">
              {isThai ? 'การจัดสรรความจุ OfflineBuffer' : 'OfflineBuffer Composition & Capacity'}
            </span>
            <span className="text-text/40 font-mono">
              ({totalPendingQueueSize} / {bufferThreshold} items · {bufferFillPct}%)
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-text/70">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block"></span>
              <span>Orders ({orderCount})</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block"></span>
              <span>Shifts ({shiftCount})</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500 inline-block"></span>
              <span>Stock ({stockCount})</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 inline-block"></span>
              <span>Admin ({adminPendingCount})</span>
            </span>
          </div>
        </div>

        {/* Multi-segment capacity progress bar */}
        <div className="h-3 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden flex">
          {totalPendingQueueSize === 0 ? (
            <div className="w-full bg-emerald-500/20 text-[9px] text-emerald-600 dark:text-emerald-400 font-mono flex items-center justify-center font-bold">
              BUFFER FULLY DRAINED & SYNCHRONIZED
            </div>
          ) : (
            <>
              {orderCount > 0 && (
                <div
                  style={{ width: `${Math.max(5, (orderCount / totalPendingQueueSize) * 100)}%` }}
                  className="bg-emerald-500 h-full transition-all duration-300"
                  title={`Orders: ${orderCount}`}
                />
              )}
              {shiftCount > 0 && (
                <div
                  style={{ width: `${Math.max(5, (shiftCount / totalPendingQueueSize) * 100)}%` }}
                  className="bg-amber-500 h-full transition-all duration-300"
                  title={`Shifts: ${shiftCount}`}
                />
              )}
              {stockCount > 0 && (
                <div
                  style={{ width: `${Math.max(5, (stockCount / totalPendingQueueSize) * 100)}%` }}
                  className="bg-cyan-500 h-full transition-all duration-300"
                  title={`Stock Adjustments: ${stockCount}`}
                />
              )}
              {adminPendingCount > 0 && (
                <div
                  style={{ width: `${Math.max(5, (adminPendingCount / totalPendingQueueSize) * 100)}%` }}
                  className="bg-indigo-500 h-full transition-all duration-300"
                  title={`Admin / Org Mutations: ${adminPendingCount}`}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* 4. Real-time Latency Sparkline Histogram */}
      {syncLatencyHistory.length > 0 && (
        <div className="space-y-2 bg-background/50 p-4 rounded-2xl border border-border/80">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-text flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-cyan-500" />
              <span>{isThai ? 'แนวโน้มความเร็วเครือข่ายย้อนหลัง (Recent Ping & Sync Latencies)' : 'Recent Latency Telemetry Sparkline'}</span>
            </span>
            <span className="text-[11px] text-text/60 font-mono">
              Last {syncLatencyHistory.length} Samples
            </span>
          </div>

          <div className="h-16 flex items-end gap-1.5 pt-2 pb-1 px-1 bg-card/60 rounded-xl border border-border/40 overflow-x-auto">
            {syncLatencyHistory.slice().reverse().map((rec) => {
              const maxScale = Math.max(300, maxSyncLatencyMs || 200);
              const heightPct = Math.min(100, Math.max(12, Math.round((rec.latencyMs / maxScale) * 100)));
              const barColor =
                rec.status === 'failed'
                  ? 'bg-rose-500'
                  : rec.latencyMs < 100
                  ? 'bg-emerald-500'
                  : rec.latencyMs < 250
                  ? 'bg-cyan-500'
                  : rec.latencyMs < 500
                  ? 'bg-amber-500'
                  : 'bg-rose-500';

              return (
                <div
                  key={rec.id}
                  className="flex-1 min-w-[14px] flex flex-col items-center gap-1 group relative cursor-pointer"
                >
                  <div
                    style={{ height: `${heightPct}%` }}
                    className={`w-full rounded-xs ${barColor} transition-all duration-300 group-hover:brightness-125`}
                  />
                  {/* Tooltip on hover */}
                  <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-20 pointer-events-none">
                    <div className="bg-slate-900 text-white text-[10px] font-mono px-2 py-1 rounded shadow-lg whitespace-nowrap border border-slate-700">
                      <div>{rec.latencyMs}ms ({rec.source})</div>
                      <div className="text-slate-400">{new Date(rec.timestamp).toLocaleTimeString()}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between text-[10px] text-text/50 font-mono px-1">
            <span>Older Samples</span>
            <span>Latest RTT</span>
          </div>
        </div>
      )}

      {/* 5. Filter Tabs & Search Bar */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Segmented Filter Control */}
          <div className="flex flex-wrap items-center gap-1 p-1 bg-background rounded-xl border border-border">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'all'
                  ? 'bg-card text-text shadow-xs'
                  : 'text-text/70 hover:text-text'
              }`}
            >
              <span>{isThai ? 'ทั้งหมด' : 'All Buffer'}</span>{' '}
              <span className="font-mono text-[10px] opacity-70">({outbox.length + adminPendingCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('pos_outbox')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'pos_outbox'
                  ? 'bg-card text-text shadow-xs'
                  : 'text-text/70 hover:text-text'
              }`}
            >
              <span>POS Outbox</span>{' '}
              <span className="font-mono text-[10px] opacity-70">({posPendingCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('admin_mutations')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'admin_mutations'
                  ? 'bg-card text-text shadow-xs'
                  : 'text-text/70 hover:text-text'
              }`}
            >
              <span>Admin / Org</span>{' '}
              <span className="font-mono text-[10px] opacity-70">({adminPendingCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('failed_conflicts')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'failed_conflicts'
                  ? 'bg-card text-text shadow-xs'
                  : 'text-text/70 hover:text-text'
              }`}
            >
              <span>{isThai ? 'ผิดพลาด/ข้อขัดแย้ง' : 'Issues'}</span>{' '}
              <span className="font-mono text-[10px] opacity-70">({totalFailedCount + totalConflictsCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('activity_log')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'activity_log'
                  ? 'bg-card text-text shadow-xs'
                  : 'text-text/70 hover:text-text'
              }`}
            >
              <span>{isThai ? 'ประวัติซิงก์เรียลไทม์' : 'Sync Log'}</span>{' '}
              <span className="font-mono text-[10px] opacity-70">({syncActivityHistory.length})</span>
            </button>
          </div>

          {/* Search Box & Clear Synced */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 transform -translate-y-1/2 text-text/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isThai ? 'ค้นหา Idempotency Key / ID...' : 'Filter key, ID...'}
                className="pl-8 pr-3 py-1.5 text-xs bg-background border border-border rounded-xl text-text placeholder:text-text/40 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 w-44 sm:w-56"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-text/40 hover:text-text text-xs"
                >
                  ×
                </button>
              )}
            </div>

            {posSyncedCount > 0 && (
              <button
                type="button"
                onClick={clearSyncedItems}
                className="px-3 py-1.5 text-xs font-medium text-text/60 hover:text-text hover:bg-background border border-border rounded-xl transition-all flex items-center gap-1 cursor-pointer whitespace-nowrap"
                title={isThai ? 'ล้างรายการที่ซิงก์สำเร็จแล้วออกจากแคช' : 'Clear completed sync archive'}
              >
                <Trash2 className="w-3.5 h-3.5 text-slate-400" />
                <span className="hidden sm:inline">{isThai ? 'ล้างที่ซิงก์แล้ว' : 'Clear Synced'}</span>
              </button>
            )}
          </div>
        </div>

        {/* 6. Main List / Table Content */}
        {activeTab === 'activity_log' ? (
          /* Sync Activity Event Log View */
          <div className="border border-border rounded-2xl overflow-hidden bg-background/50">
            {syncActivityHistory.length === 0 ? (
              <div className="p-8 text-center text-text/60 text-xs">
                {isThai ? 'ยังไม่มีประวัติกิจกรรมการซิงก์' : 'No sync activities recorded yet.'}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {syncActivityHistory.slice(0, 15).map((act) => (
                  <div key={act.id} className="p-3 sm:p-4 hover:bg-card/50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                          act.status === 'success'
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : act.status === 'failed'
                            ? 'bg-rose-500/10 text-rose-500'
                            : 'bg-amber-500/10 text-amber-500'
                        }`}
                      >
                        {act.status === 'success' ? (
                          <Check className="w-4 h-4" />
                        ) : act.status === 'failed' ? (
                          <AlertTriangle className="w-4 h-4" />
                        ) : (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        )}
                      </div>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-text">{act.entityName || act.summary}</span>
                          <span className="text-[10px] font-mono text-text/50">
                            {act.durationMs !== undefined ? `${act.durationMs}ms` : ''}
                          </span>
                        </div>
                        <p className="text-[11px] text-text/70">{act.summary}</p>
                        {act.idempotencyKey && (
                          <p className="text-[10px] font-mono text-text/50">
                            Idempotency: {act.idempotencyKey}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-[10px] text-text/50 font-mono text-right shrink-0">
                      {new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Queue Items View (POS Outbox & Firestore Mutations) */
          <div className="border border-border rounded-2xl overflow-hidden bg-background/50">
            {outbox.length === 0 && adminPendingCount === 0 ? (
              <div className="py-12 px-4 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-text">
                  {isThai ? 'OfflineBuffer ว่างเปล่า — ข้อมูลทั้งหมดซิงก์เรียบร้อย' : 'OfflineBuffer is Clean — All Data Synchronized'}
                </h4>
                <p className="text-xs text-text/60 max-w-md mx-auto">
                  {isThai
                    ? 'ไม่มีรายการคำสั่งซื้อหรือการเปลี่ยนแปลงที่ค้างอยู่ในแคช Local เครื่อง POS และ Cloud DB อยู่ในสถานะ Synchronized'
                    : 'Zero transactions or mutations buffered in IndexedDB. Local state and Cloud PostgreSQL/Firestore are in sync.'}
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleEnqueueTestItem}
                    className="px-3.5 py-1.5 text-xs font-semibold rounded-xl bg-background hover:bg-accent border border-border text-text transition-all cursor-pointer"
                  >
                    + {isThai ? 'สร้างรายการจำลองเพื่อทดสอบคิว' : 'Enqueue Simulated Item'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-card text-text/60 border-b border-border text-[11px] font-mono uppercase tracking-wider">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">{isThai ? 'ประเภท' : 'Type'}</th>
                      <th className="py-2.5 px-4 font-semibold">{isThai ? 'ข้อมูลธุรกรรม / Entity' : 'Entity / Details'}</th>
                      <th className="py-2.5 px-4 font-semibold">{isThai ? 'Idempotency Key' : 'Idempotency Key'}</th>
                      <th className="py-2.5 px-4 font-semibold">{isThai ? 'สถานะคิว' : 'Queue State'}</th>
                      <th className="py-2.5 px-4 font-semibold">{isThai ? 'รอบที่ลอง' : 'Attempts'}</th>
                      <th className="py-2.5 px-4 font-semibold">{isThai ? 'เวลาบันทึก' : 'Enqueued At'}</th>
                      <th className="py-2.5 px-4 text-right font-semibold">{isThai ? 'รายละเอียด' : 'Inspect'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {/* Render POS Outbox Items */}
                    {activeTab !== 'admin_mutations' &&
                      filteredPosItems.map((item) => {
                        const isExpanded = expandedItemId === item.id;
                        return (
                          <React.Fragment key={item.id}>
                            <tr className="hover:bg-card/40 transition-colors">
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span
                                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-mono text-[10px] font-bold ${
                                    item.type === 'order_transaction'
                                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                      : item.type === 'shift_movement'
                                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                                      : 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20'
                                  }`}
                                >
                                  {item.type.replace('_', ' ').toUpperCase()}
                                </span>
                              </td>
                              <td className="py-3 px-4">
                                <div className="font-semibold text-text truncate max-w-[200px]">
                                  {item.id}
                                </div>
                                <div className="text-[11px] text-text/60 truncate max-w-[200px]">
                                  {item.type === 'order_transaction'
                                    ? `Total: ฿${(item.payload as any)?.total || (item.payload as any)?.totalAmount || '—'}`
                                    : item.type === 'stock_adjustment'
                                    ? `SKU: ${(item.payload as any)?.sku || '—'}`
                                    : `Shift Float`}
                                </div>
                              </td>
                              <td className="py-3 px-4 font-mono text-[11px]">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate max-w-[140px] text-text/80">{item.idempotencyKey}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(item.idempotencyKey, item.id)}
                                    className="text-text/40 hover:text-text cursor-pointer"
                                    title="Copy key"
                                  >
                                    {copiedId === item.id ? (
                                      <Check className="w-3 h-3 text-emerald-500" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                </div>
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                                    item.syncState === 'synced'
                                      ? 'bg-emerald-500/10 text-emerald-500'
                                      : item.syncState === 'syncing'
                                      ? 'bg-indigo-500/10 text-indigo-500'
                                      : item.syncState === 'failed'
                                      ? 'bg-rose-500/10 text-rose-500'
                                      : 'bg-amber-500/10 text-amber-500'
                                  }`}
                                >
                                  {item.syncState === 'syncing' && <RefreshCw className="w-2.5 h-2.5 animate-spin" />}
                                  {item.syncState.toUpperCase()}
                                </span>
                              </td>
                              <td className="py-3 px-4 font-mono tabular-nums text-text/70">
                                {item.attempts || 0}
                              </td>
                              <td className="py-3 px-4 font-mono text-[11px] text-text/60 whitespace-nowrap">
                                {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </td>
                              <td className="py-3 px-4 text-right">
                                <button
                                  type="button"
                                  onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                                  className="px-2 py-1 text-[11px] font-medium text-text/70 hover:text-text hover:bg-card rounded-md transition-colors cursor-pointer"
                                >
                                  {isExpanded ? (isThai ? 'ซ่อน' : 'Close') : (isThai ? 'ตรวจดู' : 'View')}
                                </button>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-card/80">
                                <td colSpan={7} className="p-4 border-t border-border/40 font-mono text-[11px]">
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between text-text/70">
                                      <span className="font-bold text-indigo-500">PAYLOAD & REPLAY CONTRACT:</span>
                                      <span>ID: {item.id}</span>
                                    </div>
                                    <pre className="p-3 bg-slate-900 text-slate-100 rounded-xl overflow-x-auto text-[11px] max-h-48 border border-slate-800">
                                      {JSON.stringify(item.payload, null, 2)}
                                    </pre>
                                    {item.serverConfirmedId && (
                                      <div className="text-emerald-500 font-semibold flex items-center gap-1.5">
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        <span>Server Confirmed ID: {item.serverConfirmedId} ({item.serverConfirmedAt})</span>
                                      </div>
                                    )}
                                    {item.lastError && (
                                      <div className="text-rose-500 flex items-center gap-1.5">
                                        <AlertTriangle className="w-3.5 h-3.5" />
                                        <span>Error: {item.lastError}</span>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}

                    {/* Render Admin / Firestore Mutation Items */}
                    {activeTab !== 'pos_outbox' &&
                      filteredAdminItems.map((item) => {
                        const isExpanded = expandedItemId === item.id;
                        return (
                          <React.Fragment key={item.id}>
                            <tr className="hover:bg-card/40 transition-colors">
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-mono text-[10px] font-bold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                                  FIRESTORE {item.operation.toUpperCase()}
                                </span>
                              </td>
                              <td className="py-3 px-4">
                                <div className="font-semibold text-text truncate max-w-[200px]">
                                  {item.entityName}
                                </div>
                                <div className="text-[11px] text-text/60 truncate max-w-[200px]">
                                  Collection: {item.collection} ({item.documentId})
                                </div>
                              </td>
                              <td className="py-3 px-4 font-mono text-[11px]">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate max-w-[140px] text-text/80">{item.idempotencyKey}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(item.idempotencyKey, item.id)}
                                    className="text-text/40 hover:text-text cursor-pointer"
                                    title="Copy key"
                                  >
                                    {copiedId === item.id ? (
                                      <Check className="w-3 h-3 text-emerald-500" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                </div>
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                                    item.status === 'synced'
                                      ? 'bg-emerald-500/10 text-emerald-500'
                                      : item.status === 'syncing'
                                      ? 'bg-indigo-500/10 text-indigo-500'
                                      : item.status === 'conflict'
                                      ? 'bg-rose-500/10 text-rose-500'
                                      : 'bg-amber-500/10 text-amber-500'
                                  }`}
                                >
                                  {item.status === 'syncing' && <RefreshCw className="w-2.5 h-2.5 animate-spin" />}
                                  {item.status.toUpperCase()}
                                </span>
                              </td>
                              <td className="py-3 px-4 font-mono tabular-nums text-text/70">
                                {item.attempts || 0}
                              </td>
                              <td className="py-3 px-4 font-mono text-[11px] text-text/60 whitespace-nowrap">
                                {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </td>
                              <td className="py-3 px-4 text-right">
                                <button
                                  type="button"
                                  onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                                  className="px-2 py-1 text-[11px] font-medium text-text/70 hover:text-text hover:bg-card rounded-md transition-colors cursor-pointer"
                                >
                                  {isExpanded ? (isThai ? 'ซ่อน' : 'Close') : (isThai ? 'ตรวจดู' : 'View')}
                                </button>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-card/80">
                                <td colSpan={7} className="p-4 border-t border-border/40 font-mono text-[11px]">
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between text-text/70">
                                      <span className="font-bold text-indigo-500">MUTATION PAYLOAD ({item.operation}):</span>
                                      <span>Doc: {item.documentId}</span>
                                    </div>
                                    <pre className="p-3 bg-slate-900 text-slate-100 rounded-xl overflow-x-auto text-[11px] max-h-48 border border-slate-800">
                                      {JSON.stringify(item.localPayload, null, 2)}
                                    </pre>
                                    {item.errorMessage && (
                                      <div className="text-rose-500 flex items-center gap-1.5">
                                        <AlertTriangle className="w-3.5 h-3.5" />
                                        <span>Error: {item.errorMessage}</span>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 7. Footer Status Note */}
      <div className="pt-2 border-t border-border/50 flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-text/50 font-mono gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          <span>DURABLE OUTBOX INVARIANT: REPLAY-SAFE · IDEMPOTENCY KEY VERIFIED</span>
        </div>
        <div>
          <span>STORAGE ENGINE: IndexedDB (Store: prodx_pos_outbox)</span>
        </div>
      </div>
    </section>
  );
};
