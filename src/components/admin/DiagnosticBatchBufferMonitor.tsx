import React, { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  CloudUpload,
  Database,
  Layers,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  AuditBufferStats,
  DiagnosticLogDocument,
  auditService,
  subscribeToDiagnosticLogs,
} from '../../services/auditService';
import { useToast } from '../../context/ToastContext';

export const DiagnosticBatchBufferMonitor: React.FC = () => {
  const { addToast } = useToast();
  const [stats, setStats] = useState<AuditBufferStats>(() => auditService.getStats());
  const [diagnosticLogs, setDiagnosticLogs] = useState<DiagnosticLogDocument[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const unsubStats = auditService.subscribeStats((nextStats) => {
      setStats(nextStats);
    });

    const unsubscribeDiagnostics = subscribeToDiagnosticLogs(25, (docs) => {
      setDiagnosticLogs(docs);
    });

    return () => {
      unsubStats();
      unsubscribeDiagnostics();
    };
  }, []);

  const handleEnqueueSingleLog = () => {
    auditService.logDiagnosticEvent({
      peripheralId: 'periph-printer-01',
      deviceName: 'Epson TM-T88VI Receipt Printer',
      category: 'printer',
      level: 'INFO',
      event: 'ESC_POS_STATUS_POLL',
      message: 'Thermal printhead & paper sensor telemetry buffered locally',
      port: 'USB001',
      interfaceType: 'USB',
    });
  };

  const handleSimulateHighTrafficBurst = () => {
    auditService.simulateHighTrafficBurst(25);
    addToast({
      type: 'success',
      title: '⚡ จำลอง High-Traffic Log Burst (25 รายการ)',
      message:
        'รวบรวม 25 Diagnostic Logs ลง Local Buffer และส่งผ่าน PostgreSQL audit API เป็นชุด',
      durationMs: 4500,
    });
  };

  const handleManualFlush = async () => {
    if (stats.bufferedCount === 0) return;
    const countToFlush = stats.bufferedCount;
    const result = await auditService.flush();
    if (!result.error) {
      addToast({
        type: 'success',
        title: '☁️ Batch Upload ขึ้น PostgreSQL audit API สำเร็จ',
        message: `ส่งข้อมูล ${result.uploadedCount || countToFlush} รายการใน ${result.batchesCommitted} Batch (${result.batchId || 'OK'})`,
        durationMs: 4000,
      });
    } else {
      addToast({
        type: 'warning',
        title: 'เก็บข้อมูลไว้ใน Local Buffer ชั่วคราว',
        message: result.error,
        durationMs: 4500,
      });
    }
  };

  const displayedUploadedLogs =
    diagnosticLogs.length > 0 ? diagnosticLogs : stats.recentUploadedLogs;

  const bufferFillPercent = Math.min(
    100,
    Math.round((stats.bufferedCount / Math.max(1, stats.config.batchSizeThreshold)) * 100),
  );

  return (
    <section
      aria-label="Background Diagnostic Log Buffer and Firestore Batch Uploader"
      className="bg-card border border-border border-crisp rounded-3xl p-5 sm:p-6 shadow-sm space-y-4"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center text-indigo-500 shrink-0">
            <CloudUpload className={`w-5 h-5 ${stats.isFlushing ? 'animate-bounce' : ''}`} />
          </div>

          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-wider">
              <span className="font-black text-indigo-600 dark:text-indigo-400">
                AUDIT SERVICE • LOCAL BUFFER & FIRESTORE BATCH UPLOADER
              </span>
              <span aria-hidden="true" className="opacity-40">
                ·
              </span>
              <span className="text-text/60">
                Threshold: {stats.config.batchSizeThreshold} events / {stats.config.flushIntervalMs / 1000}s interval
              </span>
            </div>

            <h3 className="text-base sm:text-lg font-black text-text tracking-tight">
              ระบบบัฟเฟอร์บันทึกวินิจฉัยและอัปโหลดแบบกลุ่ม (Firestore Batch Write Engine)
            </h3>
            <p className="text-xs text-text/60">
              พักข้อมูล Diagnostic Logs ไว้ในหน่วยความจำและ LocalStorage ก่อนส่งขึ้น Firestore คราวละชุดด้วย{' '}
              <code className="font-mono text-[11px] text-indigo-500">writeBatch()</code> เพื่อลดภาระ API ช่วงทราฟฟิกสูง
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleEnqueueSingleLog}
            className="px-3 py-2 min-h-[38px] rounded-xl text-xs font-bold bg-background hover:bg-background text-text border border-border flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
          >
            <Plus className="w-3.5 h-3.5 text-indigo-500" />
            <span>พัก Log ลงบัฟเฟอร์ (+1)</span>
          </button>

          <button
            type="button"
            onClick={handleSimulateHighTrafficBurst}
            disabled={stats.isFlushing}
            className="px-3.5 py-2 min-h-[38px] rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-xs"
          >
            <Zap className="w-3.5 h-3.5 text-amber-300" />
            <span>จำลองทราฟฟิกสูง (+25 Burst)</span>
          </button>

          <button
            type="button"
            onClick={handleManualFlush}
            disabled={stats.isFlushing || stats.bufferedCount === 0}
            className="px-3.5 py-2 min-h-[38px] rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${stats.isFlushing ? 'animate-spin' : ''}`} />
            <span>
              {stats.isFlushing
                ? 'กำลัง Batch Upload...'
                : `Flush ขึ้น Firestore (${stats.bufferedCount})`}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="px-3 py-2 min-h-[38px] rounded-xl text-xs font-semibold bg-background hover:bg-background text-text/80 border border-border flex items-center gap-1 transition-all cursor-pointer"
          >
            <span>{expanded ? 'ซ่อนรายละเอียด' : 'ดูคิวบัฟเฟอร์'}</span>
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Telemetry Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
        <div className="p-3.5 rounded-2xl bg-background border border-border/80 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] font-semibold text-text/60 uppercase">
            <span>รอใน Local Buffer</span>
            <Layers className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-xl font-black font-mono text-text">
              {stats.bufferedCount}
            </span>
            <span className="text-xs text-text/50 font-mono">
              / {stats.config.batchSizeThreshold} รายการ
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden mt-2">
            <div
              className="h-full bg-amber-500 transition-all duration-300"
              style={{ width: `${bufferFillPercent}%` }}
            />
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-background border border-border/80 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] font-semibold text-text/60 uppercase">
            <span>อัปโหลดขึ้น Firestore แล้ว</span>
            <Database className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-xl font-black font-mono text-emerald-600 dark:text-emerald-400">
              {stats.totalUploadedCount}
            </span>
            <span className="text-xs text-text/50">events</span>
          </div>
          <div className="text-[11px] text-text/50 mt-1 truncate">
            ผ่าน {stats.batchesCommittedCount} writeBatch commits
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-background border border-border/80 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] font-semibold text-text/60 uppercase">
            <span>ลดจำนวนการยิง API (Saved)</span>
            <Activity className="w-3.5 h-3.5 text-indigo-500" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-xl font-black font-mono text-indigo-600 dark:text-indigo-400">
              {stats.apiCallsSavedCount}
            </span>
            <span className="text-xs text-text/50">requests saved</span>
          </div>
          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
            {stats.totalUploadedCount > 0
              ? `ประหยัด API ${Math.round((stats.apiCallsSavedCount / stats.totalUploadedCount) * 100)}%`
              : 'พร้อมรวบรวม Batch อัตโนมัติ'}
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-background border border-border/80 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] font-semibold text-text/60 uppercase">
            <span>สถานะ Batch ล่าสุด</span>
            <Clock className="w-3.5 h-3.5 text-sky-500" />
          </div>
          <div className="mt-1.5 text-xs font-mono font-bold text-text truncate">
            {stats.lastBatchId ? stats.lastBatchId : 'ยังไม่มีการ Flush'}
          </div>
          <div className="text-[11px] text-text/50 mt-1 truncate">
            {stats.lastFlushTimestamp
              ? `อัปเดตเมื่อ ${new Date(stats.lastFlushTimestamp).toLocaleTimeString('th-TH')}`
              : 'Auto-flush ทุก 8 วินาที'}
          </div>
        </div>
      </div>

      {/* Expandable Buffer & Firestore Batch Stream Inspector */}
      {expanded && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-3 border-t border-border/60">
          {/* Left: Pending Local Buffer Queue */}
          <div className="rounded-2xl bg-background border border-border p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-text flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-amber-500" />
                <span>คิวที่รอใน Local Buffer ({stats.bufferItems.length} รายการ)</span>
              </span>
              {stats.bufferItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => auditService.clearLocalBuffer()}
                  className="text-[11px] text-rose-500 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>ล้างบัฟเฟอร์</span>
                </button>
              )}
            </div>

            {stats.bufferItems.length === 0 ? (
              <div className="py-6 text-center text-xs text-text/50 font-mono">
                ✓ Local Buffer ว่างเปล่า (ส่งข้อมูลขึ้น Firestore ครบถ้วนแล้ว)
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1.5 font-mono text-[11px]">
                {stats.bufferItems.slice(0, 20).map((item) => (
                  <div
                    key={item.id}
                    className="px-2.5 py-1.5 rounded-lg bg-card border border-border/70 flex items-center justify-between gap-2"
                  >
                    <span className="font-bold text-amber-500 shrink-0">[{item.level}]</span>
                    <span className="text-text font-semibold shrink-0">{item.event}</span>
                    <span className="text-text/70 truncate flex-1">{item.message}</span>
                    <span className="text-text/40 shrink-0">{item.port || item.category}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Committed Firestore Batch Documents */}
          <div className="rounded-2xl bg-background border border-border p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-text flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span>
                  รายการที่ Batch-Upload ขึ้น Firestore `/diagnostic_logs` ล่าสุด (
                  {displayedUploadedLogs.length})
                </span>
              </span>
            </div>

            {displayedUploadedLogs.length === 0 ? (
              <div className="py-6 text-center text-xs text-text/50 font-mono">
                กด &quot;จำลองทราฟฟิกสูง (+25 Burst)&quot; เพื่อทดสอบการส่ง Batch ขึ้น Firestore
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1.5 font-mono text-[11px]">
                {displayedUploadedLogs.slice(0, 15).map((docItem) => (
                  <div
                    key={docItem.id}
                    className="px-2.5 py-1.5 rounded-lg bg-card border border-border/70 flex items-center justify-between gap-2"
                  >
                    <span
                      className={`font-bold shrink-0 ${
                        docItem.level === 'CRITICAL' || docItem.level === 'ERROR'
                          ? 'text-rose-500'
                          : docItem.level === 'WARN'
                          ? 'text-amber-500'
                          : 'text-emerald-500'
                      }`}
                    >
                      [{docItem.level}]
                    </span>
                    <span className="text-text font-semibold shrink-0">{docItem.event}</span>
                    <span className="text-text/70 truncate flex-1">{docItem.message}</span>
                    <span className="text-indigo-500 shrink-0 text-[10px]">
                      {docItem.batchId.slice(0, 14)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
