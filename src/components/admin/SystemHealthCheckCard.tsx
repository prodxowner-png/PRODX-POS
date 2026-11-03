import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Database,
  Cloud,
  Copy,
  Check,
  Download,
  ChevronDown,
  ChevronUp,
  Terminal,
  Server,
  Zap,
  Clock,
  ShieldCheck,
  Search,
} from 'lucide-react';
import {
  systemHealthCheck,
  type SystemHealthCheckResult,
} from '../../utils/systemHealthCheck';
import { useToast } from '../../context/ToastContext';

export function SystemHealthCheckCard() {
  const { addToast } = useToast();
  const [result, setResult] = useState<SystemHealthCheckResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [autoInterval, setAutoInterval] = useState<number>(0); // 0 = off, 15, 30, 60
  const [showJsonInspector, setShowJsonInspector] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [jsonSearchQuery, setJsonSearchQuery] = useState<string>('');

  const runPing = async () => {
    try {
      setLoading(true);
      const res = await systemHealthCheck.executePing();
      setResult(res);
      addToast({
        type: res.statusCode === 200 ? 'success' : res.statusCode === 207 ? 'warning' : 'error',
        title: `Health Check ${res.statusCode} ${res.status}`,
        message: `Supabase PostgreSQL: ${res.services.cloudSql.status} (${res.services.cloudSql.latencyMs}ms) | Firebase/Firestore: retired`,
        durationMs: 3500,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast({
        type: 'error',
        title: 'Ping ขัดข้อง',
        message: msg,
        durationMs: 4000,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch on mount
    runPing();

    const unsubscribe = systemHealthCheck.subscribe((updated) => {
      setResult(updated);
    });

    return () => {
      unsubscribe();
      systemHealthCheck.stopAutoPing();
    };
  }, []);

  const handleAutoIntervalChange = (seconds: number) => {
    setAutoInterval(seconds);
    if (seconds === 0) {
      systemHealthCheck.stopAutoPing();
      addToast({
        type: 'info',
        title: 'Auto-Ping ปิดการทำงาน',
        message: 'การตรวจสอบอัตโนมัติถูกปิดแล้ว',
        durationMs: 2500,
      });
    } else {
      systemHealthCheck.startAutoPing(seconds);
      addToast({
        type: 'info',
        title: `Auto-Ping ทำงานทุก ${seconds} วินาที`,
        message: 'ระบบจะตรวจสอบ Supabase PostgreSQL อย่างต่อเนื่อง โดยไม่เรียก Firebase/Firestore',
        durationMs: 2500,
      });
    }
  };

  const handleCopyJson = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.rawJson);
    setCopied(true);
    addToast({
      type: 'success',
      title: 'คัดลอก JSON แล้ว',
      message: 'Status-Coded JSON ถูกบันทึกลงใน Clipboard เรียบร้อย',
      durationMs: 2500,
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadJson = () => {
    if (!result) return;
    const blob = new Blob([result.rawJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `system-health-check-${result.timestamp.replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusConfig = useMemo(() => {
    const code = result?.statusCode ?? 503;
    if (code === 200) {
      return {
        badgeClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
        dotClass: 'bg-emerald-500 shadow-emerald-500/50',
        icon: CheckCircle2,
        label: '200 OK — สมบูรณ์ทุกระบบ (Healthy)',
        titleColor: 'text-emerald-500',
      };
    }
    if (code === 207) {
      return {
        badgeClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
        dotClass: 'bg-amber-500 shadow-amber-500/50',
        icon: AlertTriangle,
        label: '207 Multi-Status — ทำงานได้บางส่วน (Degraded)',
        titleColor: 'text-amber-500',
      };
    }
    return {
      badgeClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
      dotClass: 'bg-rose-500 shadow-rose-500/50',
      icon: XCircle,
      label: '503 Service Unavailable — ขัดข้อง (Down)',
      titleColor: 'text-rose-500',
    };
  }, [result?.statusCode]);

  const StatusIcon = statusConfig.icon;

  return (
    <div className="bg-card rounded-3xl border border-border border-crisp shadow-sm p-5 sm:p-6 space-y-6">
      {/* Header bar */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-border border-crisp">
        <div>
          <div className="flex items-center gap-2 text-indigo-500 font-semibold text-xs uppercase tracking-wider mb-1">
            <Zap className="w-4 h-4 text-amber-400" />
            SystemHealthCheck Utility • Real-Time Backend Ping
          </div>
          <h2 className="text-xl font-bold text-text flex items-center gap-2.5">
            <Activity className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            การตรวจสอบความพร้อมของบริการแบ็กเอนด์ (Supabase PostgreSQL)
          </h2>
          <p className="text-xs text-text/60 mt-0.5">
            ตรวจสอบ PostgreSQL บน Supabase ผ่าน production API; Firebase/Firestore ถูกปิดใช้งานและไม่มีการ ping ไปยัง provider เดิม
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Status badge */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all shadow-sm ${statusConfig.badgeClass}`}
          >
            <span className={`w-2.5 h-2.5 rounded-full animate-pulse shadow-sm ${statusConfig.dotClass}`} />
            <StatusIcon className="w-3.5 h-3.5" />
            <span>{statusConfig.label}</span>
          </div>

          {/* Auto-ping selector */}
          <div className="flex items-center gap-1 bg-background border border-border border-crisp rounded-xl p-1 text-xs">
            <span className="text-text/60 px-2 font-medium flex items-center gap-1">
              <Clock className="w-3 h-3" /> Auto:
            </span>
            {[0, 15, 30, 60].map((sec) => (
              <button
                key={sec}
                onClick={() => handleAutoIntervalChange(sec)}
                className={`px-2 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                  autoInterval === sec
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-text/70 hover:text-text hover:bg-card'
                }`}
              >
                {sec === 0 ? 'ปิด' : `${sec}s`}
              </button>
            ))}
          </div>

          {/* Ping Button */}
          <button
            onClick={runPing}
            disabled={loading}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-xl text-xs shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'กำลัง Ping...' : 'Ping End-to-End'}</span>
          </button>
        </div>
      </div>

      {/* Latency & Duration Metrics Bar */}
      {result && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-background/60 p-3.5 rounded-2xl border border-border border-crisp text-xs">
          <div>
            <span className="text-text/50 block text-[11px] uppercase tracking-wider">Roundtrip Latency</span>
            <span className="text-base font-bold text-text">{result.totalDurationMs} ms</span>
          </div>
          <div>
            <span className="text-text/50 block text-[11px] uppercase tracking-wider">Cloud SQL Latency</span>
            <span className="text-base font-bold text-text">
              {result.services.cloudSql.latencyMs} ms
            </span>
          </div>
          <div>
            <span className="text-text/50 block text-[11px] uppercase tracking-wider">Firestore Latency</span>
            <span className="text-base font-bold text-text">
              {result.services.firestore.latencyMs} ms
            </span>
          </div>
          <div>
            <span className="text-text/50 block text-[11px] uppercase tracking-wider">Last Ping Timestamp</span>
            <span className="text-xs font-mono text-text/80">
              {new Date(result.timestamp).toLocaleTimeString('th-TH')}
            </span>
          </div>
        </div>
      )}

      {/* Services Dual Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Service 1: Cloud SQL */}
        <div className="bg-background/80 rounded-2xl p-5 border border-border border-crisp shadow-xs space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-text flex items-center gap-2">
                  Google Cloud SQL
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 font-mono font-medium">
                    PostgreSQL 16
                  </span>
                </h3>
                <span className="text-xs text-text/60">
                  Relational Transactional Ledger & Authority Engine
                </span>
              </div>
            </div>

            {/* Status Pill */}
            {result && (
              <span
                className={`text-xs px-2.5 py-1 rounded-xl font-bold border font-mono ${
                  result.services.cloudSql.statusCode === 200
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30'
                }`}
              >
                HTTP {result.services.cloudSql.statusCode} {result.services.cloudSql.status.toUpperCase()}
              </span>
            )}
          </div>

          {/* Cloud SQL Details Table */}
          {result && (
            <div className="space-y-2 text-xs divide-y divide-border/60">
              <div className="flex justify-between py-1.5">
                <span className="text-text/60">Project ID:</span>
                <span className="font-mono text-text font-semibold">{result.services.cloudSql.projectId}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-text/60">Region:</span>
                <span className="font-mono text-text font-semibold">{result.services.cloudSql.region}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-text/60">Engine Target:</span>
                <span className="text-text font-medium">{result.services.cloudSql.engine}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-text/60">Execution Latency:</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                  {result.services.cloudSql.latencyMs} ms
                </span>
              </div>
              {result.services.cloudSql.poolStats && (
                <div className="flex justify-between py-1.5">
                  <span className="text-text/60">Connection Pool:</span>
                  <span className="text-text font-mono">
                    Total: {result.services.cloudSql.poolStats.totalConnections} | Idle: {result.services.cloudSql.poolStats.idleConnections} | Queue: {result.services.cloudSql.poolStats.waitingRequests}
                  </span>
                </div>
              )}
              {result.services.cloudSql.queryProbe && (
                <div className="flex justify-between py-1.5">
                  <span className="text-text/60">Query Probe:</span>
                  <span className="font-mono text-indigo-600 dark:text-indigo-400 font-semibold">
                    {result.services.cloudSql.queryProbe}
                  </span>
                </div>
              )}
              {result.services.cloudSql.error && (
                <div className="pt-2 text-rose-600 dark:text-rose-400 bg-rose-500/5 p-2 rounded-xl border border-rose-500/20 text-[11px]">
                  <strong>Diagnostics:</strong> {result.services.cloudSql.error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Service 2: Google Cloud Firestore */}
        <div className="bg-background/80 rounded-2xl p-5 border border-border border-crisp shadow-xs space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                <Cloud className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-text flex items-center gap-2">
                  Google Cloud Firestore
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono font-medium">
                    Native NoSQL
                  </span>
                </h3>
                <span className="text-xs text-text/60">
                  Real-time Document Store & Offline Distributed Sync
                </span>
              </div>
            </div>

            {/* Status Pill */}
            {result && (
              <span
                className={`text-xs px-2.5 py-1 rounded-xl font-bold border font-mono ${
                  result.services.firestore.statusCode === 200
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30'
                }`}
              >
                HTTP {result.services.firestore.statusCode} {result.services.firestore.status.toUpperCase()}
              </span>
            )}
          </div>

          {/* Firestore Details Table */}
          {result && (
            <div className="space-y-2 text-xs divide-y divide-border/60">
              <div className="flex justify-between py-1.5">
                <span className="text-text/60">Database ID:</span>
                <span className="font-mono text-text font-semibold truncate max-w-[220px]" title={result.services.firestore.databaseId}>
                  {result.services.firestore.databaseId}
                </span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-text/60">GCP Project:</span>
                <span className="font-mono text-text font-semibold">{result.services.firestore.projectId}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-text/60">Region / Mode:</span>
                <span className="text-text font-mono">
                  {result.services.firestore.region} ({result.services.firestore.verificationMode})
                </span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-text/60">Backend Ping Latency:</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                  {result.services.firestore.latencyMs} ms
                </span>
              </div>
              {result.services.firestore.clientDirectPingMs !== undefined && (
                <div className="flex justify-between py-1.5">
                  <span className="text-text/60">Client SDK Direct Ping:</span>
                  <span className="font-mono text-indigo-600 dark:text-indigo-400 font-bold">
                    {result.services.firestore.clientDirectPingMs} ms ({result.services.firestore.clientDirectStatus})
                  </span>
                </div>
              )}
              <div className="pt-2">
                <span className="text-text/60 block mb-1.5 font-medium">Verified Collections ({result.services.firestore.verifiedCollections.length}):</span>
                <div className="flex flex-wrap gap-1.5">
                  {result.services.firestore.verifiedCollections.map((c) => (
                    <span
                      key={c}
                      className="px-2 py-0.5 rounded-md bg-card border border-border text-[11px] font-mono text-text/80"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Summary notice */}
      {result && (
        <div className="bg-background/50 rounded-2xl p-4 border border-border border-crisp flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-text/80">
            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>
              <strong>สรุปผลการตรวจสอบ:</strong> {result.summary}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleCopyJson}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border hover:bg-card text-text/80 transition-all cursor-pointer font-medium text-xs active:scale-95"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'คัดลอกแล้ว' : 'คัดลอก JSON'}</span>
            </button>

            <button
              onClick={handleDownloadJson}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border hover:bg-card text-text/80 transition-all cursor-pointer font-medium text-xs active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              <span>ดาวน์โหลด</span>
            </button>

            <button
              onClick={() => setShowJsonInspector(!showJsonInspector)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 font-semibold transition-all cursor-pointer text-xs"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>{showJsonInspector ? 'ซ่อน JSON' : 'ดู Status-Coded JSON'}</span>
              {showJsonInspector ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      )}

      {/* Expandable Status-Coded JSON Object Inspector */}
      {showJsonInspector && result && (
        <div className="bg-slate-950 text-slate-100 rounded-2xl p-4 border border-slate-800 shadow-inner space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2 text-xs font-mono text-indigo-400 font-semibold">
              <Terminal className="w-4 h-4" />
              <span>Status-Coded JSON Payload (Response Code: {result.statusCode})</span>
            </div>

            {/* Filter Search in JSON */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3 h-3 absolute left-2.5 top-2 text-slate-500" />
                <input
                  type="text"
                  placeholder="ค้นหาใน JSON..."
                  value={jsonSearchQuery}
                  onChange={(e) => setJsonSearchQuery(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg pl-7 pr-2.5 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <button
                onClick={handleCopyJson}
                className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
              </button>
            </div>
          </div>

          <pre className="font-mono text-xs overflow-x-auto max-h-96 p-3 bg-slate-900/80 rounded-xl leading-relaxed text-emerald-400 selection:bg-indigo-700 selection:text-white">
            {jsonSearchQuery
              ? result.rawJson
                  .split('\n')
                  .filter((line) => line.toLowerCase().includes(jsonSearchQuery.toLowerCase()))
                  .join('\n') || `// ไม่พบผลลัพธ์ที่ตรงกับ "${jsonSearchQuery}"`
              : result.rawJson}
          </pre>
        </div>
      )}
    </div>
  );
}
