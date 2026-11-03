import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  CloudUpload,
  Database,
  GitMerge,
  HardDrive,
  Layers,
  RefreshCw,
  ShieldAlert,
  Trash2,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import {
  AdminFirestoreSyncStatusSnapshot,
  firestoreSyncStatusService,
  FirestoreSyncConflictAlert,
  SyncConflictResolutionStrategy,
} from '../../services/firestoreSyncStatusService';
import { auditService, AuditBufferStats } from '../../services/auditService';
import { useOffline } from '../../context/OfflineContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';

export interface AdminSyncStatusIndicatorProps {
  variant?: 'header' | 'banner';
}

export const AdminSyncStatusIndicator: React.FC<AdminSyncStatusIndicatorProps> = ({
  variant = 'header',
}) => {
  const { language } = useLanguage();
  const { addToast } = useToast();
  const { isOnline, pendingCount: posOutboxPendingCount, currentConflict } = useOffline();
  const isThai = language === 'th';

  const [snapshot, setSnapshot] = useState<AdminFirestoreSyncStatusSnapshot>(() =>
    firestoreSyncStatusService.getSnapshot(),
  );
  const [diagTelemetry, setDiagTelemetry] = useState<AuditBufferStats>(() =>
    auditService.getStats(),
  );
  const [isOpen, setIsOpen] = useState(false);
  const [selectedConflict, setSelectedConflict] = useState<FirestoreSyncConflictAlert | null>(null);
  const [isFlushing, setIsFlushing] = useState(false);

  // Subscribe to firestoreSyncStatusService and auditService buffer telemetry
  useEffect(() => {
    const unsubSync = firestoreSyncStatusService.subscribe((next) => {
      setSnapshot(next);
      if (next.conflicts.length > 0 && !selectedConflict) {
        setSelectedConflict(next.conflicts[0]);
      } else if (next.conflicts.length === 0) {
        setSelectedConflict(null);
      }
    });

    const unsubAudit = auditService.subscribeStats((nextDiag) => {
      setDiagTelemetry(nextDiag);
      firestoreSyncStatusService.updateExternalQueueMetrics({
        diagnosticBufferCount: nextDiag.bufferedCount,
      });
    });

    return () => {
      unsubSync();
      unsubAudit();
    };
  }, [selectedConflict]);

  // Keep POS OfflineContext metrics synchronized with the Admin Sync Status service
  useEffect(() => {
    firestoreSyncStatusService.updateExternalQueueMetrics({
      posOutboxPendingCount,
      isOffline: !isOnline,
    });
  }, [posOutboxPendingCount, isOnline]);

  const totalPendingWrites =
    snapshot.FirestoreWriteQueueCount +
    diagTelemetry.bufferedCount +
    posOutboxPendingCount;

  const totalConflicts = snapshot.conflictCount + (currentConflict ? 1 : 0);
  const hasConflicts = totalConflicts > 0;
  const hasPendingQueue = totalPendingWrites > 0;

  const handleFlushAllWrites = async () => {
    setIsFlushing(true);
    try {
      const [queueResult, auditResult] = await Promise.all([
        firestoreSyncStatusService.processPendingWriteQueue(),
        auditService.flush(),
      ]);

      if (queueResult.conflictsDetected > 0) {
        addToast({
          title: isThai
            ? 'ตรวจพบความขัดแย้งในการซิงค์ (Sync Conflict)'
            : 'Synchronization Conflict Detected',
          message: isThai
            ? `พบข้อมูลขัดแย้ง ${queueResult.conflictsDetected} รายการระหว่าง Local Offline Buffer กับ Firestore`
            : `${queueResult.conflictsDetected} item(s) in the local offline buffer conflict with Cloud Firestore.`,
          type: 'error',
        });
      } else {
        addToast({
          title: isThai ? 'ซิงค์คิวข้อมูลลง Firestore สำเร็จ' : 'Firestore Write Queue Flushed',
          message: isThai
            ? `อัปโหลดรายการแก้ไข ${queueResult.synced} รายการ และ Diagnostic Logs ${auditResult.uploadedCount} รายการเรียบร้อย`
            : `Committed ${queueResult.synced} entity writes and ${auditResult.uploadedCount} diagnostic log events to Firestore.`,
          type: 'success',
        });
      }
    } finally {
      setIsFlushing(false);
    }
  };

  const handleSimulateConflict = () => {
    const { conflictItem } = firestoreSyncStatusService.simulateOfflineQueueAndConflict();
    setSelectedConflict({
      id: `alert-${conflictItem.id}`,
      writeItemId: conflictItem.id,
      collection: conflictItem.collection,
      documentId: conflictItem.documentId,
      entityName: conflictItem.entityName,
      operation: conflictItem.operation,
      reason: conflictItem.conflictReason || 'remote_modified_while_offline',
      detectedAt: conflictItem.conflictDetectedAt || Date.now(),
      conflictingFields: conflictItem.conflictingFields || ['name', 'ipAddress', 'paperWidth', 'status'],
      localPayload: conflictItem.localPayload,
      remotePayload: conflictItem.remotePayload ?? null,
      summary: conflictItem.errorMessage || 'Synchronization conflict detected',
    });
    setIsOpen(true);
    addToast({
      title: isThai
        ? 'แจ้งเตือน: พบความขัดแย้งใน Local Offline Buffer!'
        : 'Alert: Offline Buffer Synchronization Conflict!',
      message: isThai
        ? `ตรวจพบการแก้ไขข้อมูลขัดแย้งกันของ ${conflictItem.entityName} กรุณาตรวจสอบและเลือกวิธีแก้ไข`
        : `Conflicting offline buffer state detected on ${conflictItem.entityName}. Admin resolution required.`,
      type: 'error',
    });
  };

  const handleResolveConflict = async (
    writeItemId: string,
    strategy: SyncConflictResolutionStrategy,
  ) => {
    const resolved = await firestoreSyncStatusService.resolveConflict(writeItemId, strategy);
    if (resolved) {
      const strategyLabel =
        strategy === 'keep_local'
          ? isThai
            ? 'ใช้ข้อมูลจากเครื่อง (Keep Local)'
            : 'Kept Local Buffer Version'
          : strategy === 'keep_cloud'
          ? isThai
            ? 'ใช้ข้อมูลบนคลาวด์ (Keep Cloud)'
            : 'Adopted Cloud Firestore Version'
          : isThai
          ? 'ผสานข้อมูลทั้งสองฝั่ง (Auto-Merged)'
          : 'Merged Local & Cloud Changes';

      addToast({
        title: isThai ? 'แก้ไขความขัดแย้งสำเร็จ' : 'Sync Conflict Resolved',
        message: `${resolved.entityName}: ${strategyLabel}`,
        type: 'success',
      });
    }
  };

  if (variant === 'banner') {
    return (
      <div
        data-testid="admin-sync-status-banner"
        className={`rounded-2xl border p-4 transition-all ${
          hasConflicts
            ? 'bg-rose-950/95 border-rose-500/60 text-white shadow-lg shadow-rose-950/25'
            : hasPendingQueue
            ? 'bg-amber-950/90 border-amber-500/40 text-white'
            : 'bg-slate-900 border-slate-800 text-slate-100'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div
              className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 border ${
                hasConflicts
                  ? 'bg-rose-500/20 border-rose-400/40 text-rose-300 animate-pulse'
                  : hasPendingQueue
                  ? 'bg-amber-500/20 border-amber-400/40 text-amber-300'
                  : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
              }`}
            >
              {hasConflicts ? (
                <ShieldAlert className="h-6 w-6" />
              ) : hasPendingQueue ? (
                <CloudUpload className="h-6 w-6" />
              ) : (
                <CheckCircle2 className="h-6 w-6" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-black uppercase tracking-wider">
                  {hasConflicts
                    ? isThai
                      ? 'แจ้งเตือนด่วน: พบความขัดแย้งของข้อมูลใน Local Offline Buffer (SYNC CONFLICT)'
                      : 'CRITICAL ALERT: Local Offline Buffer Synchronization Conflict'
                    : hasPendingQueue
                    ? isThai
                      ? 'สถานะการซิงค์: มีคิวรอเขียนข้อมูลลง Firestore (Pending Writes Queued)'
                      : 'SYNC STATUS: Pending Firestore Writes in Local Queue'
                    : isThai
                    ? 'สถานะการซิงค์: ข้อมูลทั้งหมดซิงค์ตรงกับ Cloud Firestore 100%'
                    : 'SYNC STATUS: All Local Buffers Synchronized with Cloud Firestore'}
                </span>

                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase border ${
                    hasConflicts
                      ? 'bg-rose-500/30 border-rose-400 text-rose-200'
                      : hasPendingQueue
                      ? 'bg-amber-500/25 border-amber-400/50 text-amber-200'
                      : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                  }`}
                >
                  {hasConflicts
                    ? `${totalConflicts} CONFLICT${totalConflicts > 1 ? 'S' : ''}`
                    : `${totalPendingWrites} PENDING WRITES`}
                </span>
              </div>

              <div className="text-xs text-slate-300 mt-1 flex items-center gap-4 flex-wrap">
                <span>
                  {isThai ? 'คิวแก้ไขโครงสร้างองค์กร:' : 'Entity Write Queue:'}{' '}
                  <strong className="font-mono text-white">
                    {snapshot.FirestoreWriteQueueCount}
                  </strong>
                </span>
                <span>
                  {isThai ? 'บัฟเฟอร์ Diagnostic Logs:' : 'Diagnostic Batch Buffer:'}{' '}
                  <strong className="font-mono text-white">{diagTelemetry.bufferedCount}</strong>
                </span>
                <span>
                  {isThai ? 'คิวธุรกรรมออฟไลน์:' : 'POS Offline Outbox:'}{' '}
                  <strong className="font-mono text-white">{posOutboxPendingCount}</strong>
                </span>
                <span className="text-rose-300 font-bold">
                  {isThai ? 'รายการที่ขัดแย้งกัน (Conflicts):' : 'Sync Conflicts:'}{' '}
                  <strong className="font-mono">{totalConflicts}</strong>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              data-testid="banner-simulate-sync-conflict-btn"
              onClick={handleSimulateConflict}
              className="h-9 px-3 rounded-xl border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Zap className="h-3.5 w-3.5" />
              <span>{isThai ? 'จำลอง Sync Conflict' : 'Simulate Sync Conflict'}</span>
            </button>

            <button
              type="button"
              onClick={() => void handleFlushAllWrites()}
              disabled={isFlushing || totalPendingWrites === 0}
              className="h-9 px-3.5 rounded-xl bg-[#ff6b1a] hover:bg-[#e55a0d] disabled:opacity-40 text-white text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFlushing ? 'animate-spin' : ''}`} />
              <span>{isThai ? 'ซิงค์คิวทั้งหมดทันที' : 'Flush Pending Writes'}</span>
            </button>
          </div>
        </div>

        {/* Inline Conflict Resolution Cards when Conflicts Exist */}
        {snapshot.conflicts.length > 0 && (
          <div className="mt-4 pt-4 border-t border-rose-500/30 space-y-3">
            {snapshot.conflicts.map((conflict) => (
              <div
                key={conflict.id}
                data-testid={`sync-conflict-card-${conflict.documentId}`}
                className="rounded-xl bg-slate-950/90 border border-rose-500/50 p-4 space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                      <span className="text-xs font-black text-white">
                        {conflict.entityName}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 font-mono text-[10px] text-rose-300">
                        {conflict.collection}/{conflict.documentId}
                      </span>
                    </div>
                    <p className="text-[11px] text-rose-200/90 mt-1">{conflict.summary}</p>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => void handleResolveConflict(conflict.writeItemId, 'keep_local')}
                      className="px-2.5 py-1.5 rounded-lg bg-[#ff6b1a] hover:bg-[#e55a0d] text-white text-[11px] font-black transition-all cursor-pointer"
                    >
                      {isThai ? 'ใช้ค่าในเครื่อง (Force Local)' : 'Keep Local Buffer'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleResolveConflict(conflict.writeItemId, 'merge')}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-black flex items-center gap-1 transition-all cursor-pointer"
                    >
                      <GitMerge className="h-3 w-3" />
                      {isThai ? 'ผสานข้อมูล (Auto-Merge)' : 'Auto-Merge'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleResolveConflict(conflict.writeItemId, 'keep_cloud')}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold transition-all cursor-pointer"
                    >
                      {isThai ? 'ใช้ค่าบน Cloud' : 'Keep Cloud'}
                    </button>
                  </div>
                </div>

                {/* Diff Preview of Conflicting Fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-[11px] font-mono">
                  <div className="rounded-lg bg-slate-900/90 border border-slate-800 p-2.5">
                    <div className="text-[10px] font-sans font-black uppercase text-amber-400 mb-1">
                      {isThai ? 'ข้อมูลใน Local Offline Buffer' : 'Local Offline Buffer Version'}
                    </div>
                    <div className="space-y-0.5 text-slate-300">
                      {conflict.conflictingFields.map((field) => (
                        <div key={field} className="truncate">
                          <span className="text-slate-400">{field}:</span>{' '}
                          <span className="text-amber-300 font-bold">
                            {JSON.stringify(conflict.localPayload[field])}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg bg-slate-900/90 border border-slate-800 p-2.5">
                    <div className="text-[10px] font-sans font-black uppercase text-sky-400 mb-1">
                      {isThai ? 'ข้อมูลปัจจุบันบน Cloud Firestore' : 'Cloud Firestore Version'}
                    </div>
                    <div className="space-y-0.5 text-slate-300">
                      {conflict.conflictingFields.map((field) => (
                        <div key={field} className="truncate">
                          <span className="text-slate-400">{field}:</span>{' '}
                          <span className="text-sky-300 font-bold">
                            {conflict.remotePayload
                              ? JSON.stringify(conflict.remotePayload[field])
                              : 'DELETED'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Header Variant (Top Bar of AdminConsoleLayout)
  return (
    <div className="relative" data-testid="admin-sync-status-indicator">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-label="Firestore Sync Status & Conflict Monitor"
        className={`h-9 px-3 rounded-xl border text-xs font-black flex items-center gap-2 transition-all cursor-pointer ${
          hasConflicts
            ? 'bg-rose-600/20 border-rose-500 text-rose-300 hover:bg-rose-600/30 shadow-lg shadow-rose-600/20 animate-pulse'
            : !isOnline
            ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 hover:bg-amber-500/30'
            : hasPendingQueue
            ? 'bg-amber-500/15 border-amber-500/40 text-amber-200 hover:bg-amber-500/25'
            : 'bg-slate-900 border-slate-800 text-emerald-300 hover:bg-slate-800'
        }`}
      >
        {hasConflicts ? (
          <ShieldAlert className="h-4 w-4 text-rose-400 shrink-0" />
        ) : !isOnline ? (
          <WifiOff className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        ) : snapshot.isSyncing || isFlushing ? (
          <RefreshCw className="h-3.5 w-3.5 text-sky-400 animate-spin shrink-0" />
        ) : hasPendingQueue ? (
          <CloudUpload className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        )}

        <span className="hidden sm:inline">
          {hasConflicts
            ? isThai
              ? `พบข้อมูลขัดแย้ง (${totalConflicts})`
              : `Sync Conflict (${totalConflicts})`
            : hasPendingQueue
            ? isThai
              ? `รอซิงค์ (${totalPendingWrites})`
              : `Sync Queue (${totalPendingWrites})`
            : isThai
            ? 'Sync Status: ปกติ'
            : 'Sync Status: OK'}
        </span>

        {/* Compact Counter Badge */}
        <span
          data-testid="admin-sync-queue-badge"
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
            hasConflicts
              ? 'bg-rose-500 text-white'
              : hasPendingQueue
              ? 'bg-amber-500/30 text-amber-200'
              : 'bg-emerald-500/20 text-emerald-300'
          }`}
        >
          {hasConflicts ? `!${totalConflicts}` : totalPendingWrites}
        </span>

        <ChevronDown
          className={`h-3.5 w-3.5 opacity-70 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Popover Inspector Drawer */}
      {isOpen && (
        <div
          data-testid="admin-sync-status-popover"
          className="fixed sm:absolute right-3 sm:right-0 top-16 sm:top-11 z-50 w-[calc(100vw-1.5rem)] sm:w-[460px] rounded-2xl border border-slate-700 bg-slate-950 text-white shadow-2xl overflow-hidden"
        >
          {/* Popover Header */}
          <div
            className={`px-4 py-3.5 border-b flex items-center justify-between ${
              hasConflicts
                ? 'bg-rose-950/90 border-rose-500/40'
                : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {hasConflicts ? (
                <ShieldAlert className="h-5 w-5 text-rose-400 shrink-0" />
              ) : (
                <Database className="h-5 w-5 text-[#ff6b1a] shrink-0" />
              )}
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-white">
                  {isThai
                    ? 'สถานะคิวเขียนข้อมูล Firestore & ข้อขัดแย้งออฟไลน์'
                    : 'Firestore Write Queue & Conflict Monitor'}
                </h3>
                <p className="text-[11px] text-slate-400">
                  {hasConflicts
                    ? isThai
                      ? `ตรวจพบความขัดแย้งใน Local Offline Buffer ${totalConflicts} รายการ`
                      : `${totalConflicts} offline buffer synchronization conflict(s) require admin action`
                    : isThai
                    ? `คิวรออัปโหลดลง Firestore ทั้งหมด ${totalPendingWrites} รายการ`
                    : `${totalPendingWrites} pending write operation(s) queued for Cloud Firestore`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Queue Metrics Grid */}
          <div className="p-4 space-y-4 max-h-[78vh] overflow-y-auto">
            <div className="grid grid-cols-3 gap-2.5">
              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase text-slate-400">
                  <span>{isThai ? 'คิว Entity' : 'Entity Writes'}</span>
                  <Layers className="h-3.5 w-3.5 text-[#ff6b1a]" />
                </div>
                <div className="text-xl font-black font-mono text-white mt-1">
                  {snapshot.FirestoreWriteQueueCount}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  Org / Branch / POS
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase text-slate-400">
                  <span>{isThai ? 'บัฟเฟอร์ Log' : 'Log Buffer'}</span>
                  <HardDrive className="h-3.5 w-3.5 text-sky-400" />
                </div>
                <div className="text-xl font-black font-mono text-white mt-1">
                  {diagTelemetry.bufferedCount}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  Diagnostic Batch
                </div>
              </div>

              <div
                className={`rounded-xl border p-3 ${
                  hasConflicts
                    ? 'border-rose-500/60 bg-rose-950/60'
                    : 'border-slate-800 bg-slate-900/90'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-bold uppercase text-slate-300">
                  <span>{isThai ? 'ข้อขัดแย้ง' : 'Conflicts'}</span>
                  <AlertTriangle
                    className={`h-3.5 w-3.5 ${
                      hasConflicts ? 'text-rose-400' : 'text-emerald-400'
                    }`}
                  />
                </div>
                <div
                  className={`text-xl font-black font-mono mt-1 ${
                    hasConflicts ? 'text-rose-300' : 'text-emerald-400'
                  }`}
                >
                  {totalConflicts}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {hasConflicts ? 'Action Required' : 'Zero Conflicts'}
                </div>
              </div>
            </div>

            {/* Active Synchronization Conflict Visual Alert Section */}
            {snapshot.conflicts.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    {isThai
                      ? 'รายการที่เกิด Synchronization Conflict'
                      : 'Active Offline Buffer Conflicts'}
                  </span>
                  {snapshot.conflicts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => void firestoreSyncStatusService.resolveAllConflicts('merge')}
                      className="text-[10px] font-bold text-emerald-400 hover:underline cursor-pointer"
                    >
                      {isThai ? 'ผสานข้อมูลทั้งหมด (Merge All)' : 'Auto-Merge All'}
                    </button>
                  )}
                </div>

                {snapshot.conflicts.map((conflict) => (
                  <div
                    key={conflict.id}
                    className="rounded-xl border border-rose-500/50 bg-rose-950/40 p-3.5 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-black text-white flex items-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                          <span>{conflict.entityName}</span>
                        </div>
                        <div className="text-[10px] font-mono text-rose-300 mt-0.5">
                          {conflict.collection}/{conflict.documentId} •{' '}
                          {conflict.reason.replace(/_/g, ' ').toUpperCase()}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-rose-500/30 border border-rose-400/40 text-[10px] font-mono font-bold text-rose-200">
                        {conflict.conflictingFields.length} fields
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      {conflict.summary}
                    </p>

                    {/* Field-level diff */}
                    <div className="rounded-lg bg-slate-950/90 border border-slate-800 p-2.5 space-y-1.5 text-[10px] font-mono">
                      {conflict.conflictingFields.slice(0, 4).map((field) => (
                        <div key={field} className="grid grid-cols-1 gap-0.5">
                          <span className="text-slate-400 font-bold">{field}:</span>
                          <div className="flex items-center justify-between gap-2 pl-2">
                            <span className="text-amber-300 truncate">
                              Local: {JSON.stringify(conflict.localPayload[field])}
                            </span>
                            <span className="text-sky-300 truncate">
                              Cloud:{' '}
                              {conflict.remotePayload
                                ? JSON.stringify(conflict.remotePayload[field])
                                : 'DELETED'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          void handleResolveConflict(conflict.writeItemId, 'keep_local')
                        }
                        className="flex-1 h-8 rounded-lg bg-[#ff6b1a] hover:bg-[#e55a0d] text-white text-[11px] font-black transition-colors cursor-pointer"
                      >
                        {isThai ? 'ใช้ค่าในเครื่อง (Keep Local)' : 'Keep Local'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleResolveConflict(conflict.writeItemId, 'merge')}
                        className="flex-1 h-8 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-black flex items-center justify-center gap-1 transition-colors cursor-pointer"
                      >
                        <GitMerge className="h-3 w-3" />
                        <span>{isThai ? 'ผสาน (Merge)' : 'Merge'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void handleResolveConflict(conflict.writeItemId, 'keep_cloud')
                        }
                        className="flex-1 h-8 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold transition-colors cursor-pointer"
                      >
                        {isThai ? 'ใช้ค่า Cloud' : 'Keep Cloud'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pending Write Queue List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                  {isThai
                    ? `คิวรอเขียนข้อมูลลง Firestore (${snapshot.queue.length})`
                    : `Pending Firestore Write Queue (${snapshot.queue.length})`}
                </span>
                {snapshot.queue.length > 0 && (
                  <button
                    type="button"
                    onClick={() => firestoreSyncStatusService.clearQueue()}
                    className="text-[10px] font-bold text-slate-400 hover:text-rose-400 flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>{isThai ? 'ล้างคิว' : 'Clear'}</span>
                  </button>
                )}
              </div>

              {snapshot.queue.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-center text-xs text-slate-400">
                  {isThai
                    ? 'ไม่มีรายการแก้ไขค้างในคิว Local Offline Buffer'
                    : 'No uncommitted entity writes in the local offline buffer.'}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                  {snapshot.queue.map((item) => (
                    <div
                      key={item.id}
                      className={`rounded-xl border p-2.5 flex items-center justify-between gap-2 text-xs ${
                        item.status === 'conflict'
                          ? 'border-rose-500/40 bg-rose-950/30'
                          : 'border-slate-800 bg-slate-900/80'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-white truncate">{item.entityName}</div>
                        <div className="text-[10px] font-mono text-slate-400 truncate">
                          {item.operation.toUpperCase()} • {item.collection}/{item.documentId}
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase shrink-0 ${
                          item.status === 'conflict'
                            ? 'bg-rose-500/30 text-rose-300 border border-rose-500/40'
                            : item.status === 'syncing'
                            ? 'bg-sky-500/20 text-sky-300'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer Controls */}
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
              <button
                type="button"
                data-testid="popover-simulate-conflict-btn"
                onClick={handleSimulateConflict}
                className="h-9 px-3 rounded-xl border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Zap className="h-3.5 w-3.5" />
                <span>{isThai ? 'จำลองคิว + Conflict' : 'Simulate Queue & Conflict'}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleFlushAllWrites()}
                disabled={isFlushing || totalPendingWrites === 0}
                className="h-9 px-3.5 rounded-xl bg-[#ff6b1a] hover:bg-[#e55a0d] disabled:opacity-40 text-white text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isFlushing ? 'animate-spin' : ''}`} />
                <span>{isThai ? 'ซิงค์ลง Firestore' : 'Flush Writes Now'}</span>
              </button>
            </div>

            {snapshot.lastSyncedAt && (
              <div className="text-[10px] font-mono text-slate-400 flex items-center justify-between pt-1">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Last Firestore Commit: {new Date(snapshot.lastSyncedAt).toLocaleTimeString()}
                </span>
                <span>Total Committed: {snapshot.totalSyncedCount}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
