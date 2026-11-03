import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Activity,
  Play,
  Pause,
  RefreshCw,
  Database,
  Cloud,
  Clock,
  TrendingDown,
  TrendingUp,
  BarChart3,
  Download,
  Trash2,
  Zap,
  Gauge,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Cpu,
  Layers,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';

export interface LatencySample {
  id: string;
  sampleIndex: number;
  clientSentPerfNow: number;
  timestamp: string;
  timeStr: string;
  readinessRttMs: number;
  readinessStatus: 'ok' | 'error';
  cloudSqlRttMs: number;
  cloudSqlQueryDurationMs: number;
  cloudSqlStatus: 'ok' | 'error';
  networkTransitMs: number;
}

export function RealtimeLatencyDiagnosticPanel() {
  const { addToast } = useToast();

  const [isStreaming, setIsStreaming] = useState<boolean>(true);
  const [intervalMs, setIntervalMs] = useState<number>(2000); // 1000, 2000, 5000
  const [isPinging, setIsPinging] = useState<boolean>(false);
  const [samples, setSamples] = useState<LatencySample[]>([]);
  const [sampleCounter, setSampleCounter] = useState<number>(0);
  const [lastPingTime, setLastPingTime] = useState<number | null>(null);

  const sampleCounterRef = useRef<number>(0);
  const isPingingRef = useRef<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // High-precision ping execution using performance.now()
  const executeLatencyPing = async () => {
    if (isPingingRef.current) return;
    isPingingRef.current = true;
    setIsPinging(true);

    const clientSentPerfNow = performance.now();
    const now = new Date();
    const timeStr = now.toLocaleTimeString('th-TH', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    let readinessRttMs = 0;
    let readinessStatus: 'ok' | 'error' = 'ok';

    let cloudSqlRttMs = 0;
    let cloudSqlQueryDurationMs = 0;
    let cloudSqlStatus: 'ok' | 'error' = 'ok';
    let networkTransitMs = 0;

    try {
      // 1. Probe the production readiness endpoint; this exercises the server-authoritative PostgreSQL check.
      const readinessStart = performance.now();
      try {
        const response = await fetch('/api/v1/readyz', { headers: { Accept: 'application/json' } });
        readinessRttMs = Number((performance.now() - readinessStart).toFixed(2));
        readinessStatus = response.ok ? 'ok' : 'error';
      } catch {
        readinessRttMs = Number((performance.now() - readinessStart).toFixed(2));
        readinessStatus = 'error';
      }

      // 2. Supabase PostgreSQL RTT probe via backend with performance.now()
      const sqlStart = performance.now();
      try {
        const resp = await fetch(`/api/v1/infrastructure/latency-ping?clientTime=${sqlStart}`);
        const sqlEnd = performance.now();
        cloudSqlRttMs = Number((sqlEnd - sqlStart).toFixed(2));

        if (resp.ok) {
          const body = await resp.json().catch(() => null);
          cloudSqlQueryDurationMs = body?.cloudSql?.queryDurationMs ?? 0;
          cloudSqlStatus = body?.cloudSql?.success ? 'ok' : 'error';
          networkTransitMs = Number(Math.max(0, cloudSqlRttMs - (body?.serverProcessTimeMs ?? 0)).toFixed(2));
        } else {
          cloudSqlStatus = 'error';
        }
      } catch {
        cloudSqlRttMs = Number((performance.now() - sqlStart).toFixed(2));
        cloudSqlStatus = 'error';
      }

      sampleCounterRef.current += 1;
      const newIndex = sampleCounterRef.current;
      setSampleCounter(newIndex);
      setLastPingTime(performance.now());

      const newSample: LatencySample = {
        id: `sample-${newIndex}-${Date.now()}`,
        sampleIndex: newIndex,
        clientSentPerfNow,
        timestamp: now.toISOString(),
        timeStr,
        readinessRttMs,
        readinessStatus,
        cloudSqlRttMs,
        cloudSqlQueryDurationMs,
        cloudSqlStatus,
        networkTransitMs,
      };

      setSamples((prev) => {
        const updated = [...prev, newSample];
        return updated.length > 30 ? updated.slice(updated.length - 30) : updated;
      });
    } finally {
      isPingingRef.current = false;
      setIsPinging(false);
    }
  };

  // Manage real-time streaming interval
  useEffect(() => {
    // Initial immediate ping
    executeLatencyPing();

    if (isStreaming) {
      timerRef.current = setInterval(() => {
        executeLatencyPing();
      }, intervalMs);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isStreaming, intervalMs]);

  // Statistical calculations
  const stats = useMemo(() => {
    if (samples.length === 0) {
      return {
        cloudSql: { current: 0, min: 0, max: 0, avg: 0, p95: 0, jitter: 0 },
        readiness: { current: 0, min: 0, max: 0, avg: 0, p95: 0, jitter: 0 },
      };
    }

    const sqlVals = samples.map((s) => s.cloudSqlRttMs);
    const fsVals = samples.map((s) => s.readinessRttMs);

    const calcStats = (vals: number[]) => {
      const sorted = [...vals].sort((a, b) => a - b);
      const min = Number(sorted[0].toFixed(2));
      const max = Number(sorted[sorted.length - 1].toFixed(2));
      const avg = Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
      const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
      const p95 = Number(sorted[p95Index].toFixed(2));

      let jitterSum = 0;
      for (let i = 1; i < vals.length; i++) {
        jitterSum += Math.abs(vals[i] - vals[i - 1]);
      }
      const jitter = vals.length > 1 ? Number((jitterSum / (vals.length - 1)).toFixed(2)) : 0;

      return {
        current: Number(vals[vals.length - 1].toFixed(2)),
        min,
        max,
        avg,
        p95,
        jitter,
      };
    };

    return {
      cloudSql: calcStats(sqlVals),
      readiness: calcStats(fsVals),
    };
  }, [samples]);

  // Export samples to CSV
  const handleExportCsv = () => {
    if (samples.length === 0) return;
    const headers = [
      'SampleIndex',
      'Timestamp',
      'ClientPerfNowMs',
      'SupabasePostgreSQLRttMs',
      'CloudSqlQueryMs',
      'CloudSqlStatus',
      'Readiness APIRttMs',
      'Readiness APIStatus',
      'NetworkTransitMs',
    ].join(',');

    const rows = samples.map((s) =>
      [
        s.sampleIndex,
        s.timestamp,
        s.clientSentPerfNow.toFixed(3),
        s.cloudSqlRttMs,
        s.cloudSqlQueryDurationMs,
        s.cloudSqlStatus,
        s.readinessRttMs,
        s.readinessStatus,
        s.networkTransitMs,
      ].join(',')
    );

    const csvContent = [headers, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prodx-latency-metrics-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    addToast({
      type: 'success',
      title: 'ส่งออกข้อมูล CSV แล้ว',
      message: `บันทึกข้อมูลสถิติ Latency ทั้งหมด ${samples.length} รายการ`,
      durationMs: 2500,
    });
  };

  const handleClearSamples = () => {
    setSamples([]);
    sampleCounterRef.current = 0;
    setSampleCounter(0);
    addToast({
      type: 'info',
      title: 'ล้างข้อมูลสถิติแล้ว',
      message: 'เริ่มต้นเก็บบันทึกข้อมูล Latency รอบใหม่',
      durationMs: 2000,
    });
  };

  // Helper for latency rating badges
  const getRatingBadge = (ms: number, status: 'ok' | 'error') => {
    if (status === 'error') {
      return {
        label: 'Error / Unreachable',
        className: 'bg-rose-500/10 text-rose-500 border-rose-500/30',
      };
    }
    if (ms < 30) {
      return {
        label: 'Ultra Fast (<30ms)',
        className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
      };
    }
    if (ms < 100) {
      return {
        label: 'Optimal (30-100ms)',
        className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
      };
    }
    if (ms < 250) {
      return {
        label: 'Moderate (100-250ms)',
        className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
      };
    }
    return {
      label: 'High Latency (>250ms)',
      className: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
    };
  };

  // High-performance SVG Sparkline Chart Dimensions
  const chartHeight = 110;
  const chartWidth = 500;
  const maxChartVal = useMemo(() => {
    if (samples.length === 0) return 100;
    const all = samples.flatMap((s) => [s.cloudSqlRttMs, s.readinessRttMs]);
    return Math.max(80, Math.ceil(Math.max(...all) * 1.25));
  }, [samples]);

  const generatePoints = (key: 'cloudSqlRttMs' | 'readinessRttMs') => {
    if (samples.length < 2) return '';
    return samples
      .map((s, idx) => {
        const x = (idx / (samples.length - 1)) * chartWidth;
        const y = chartHeight - (Math.min(s[key], maxChartVal) / maxChartVal) * (chartHeight - 15) - 8;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  };

  const sqlPoints = useMemo(() => generatePoints('cloudSqlRttMs'), [samples, maxChartVal]);
  const fsPoints = useMemo(() => generatePoints('readinessRttMs'), [samples, maxChartVal]);

  const sqlBadge = getRatingBadge(stats.cloudSql.current, samples[samples.length - 1]?.cloudSqlStatus ?? 'ok');
  const fsBadge = getRatingBadge(stats.readiness.current, samples[samples.length - 1]?.readinessStatus ?? 'ok');

  return (
    <div className="bg-card rounded-3xl border border-border border-crisp shadow-sm p-5 sm:p-6 space-y-6">
      {/* Header bar with live pulse */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-border border-crisp">
        <div>
          <div className="flex items-center gap-2 text-indigo-500 font-semibold text-xs uppercase tracking-wider mb-1">
            <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
            Real-Time Round-Trip Latency Diagnostics (performance.now())
          </div>
          <h2 className="text-xl font-bold text-text flex items-center gap-2.5">
            <Gauge className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            แผงวิเคราะห์เวลาตอบสนองแบบเรียลไทม์ (Cloud SQL & Readiness API RTT)
          </h2>
          <p className="text-xs text-text/60 mt-0.5">
            วัดความหน่วงของเครือข่ายและเวลาประมวลผลคำสั่งด้วย High-Resolution Timestamps (performance.now()) ระดับไมโครวินาที
          </p>
        </div>

        {/* Live streaming controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Live Indicator */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-background border border-border text-xs font-semibold text-text">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isStreaming ? 'bg-emerald-500 animate-ping' : 'bg-slate-400'
              }`}
            />
            <span>{isStreaming ? 'สตรีมสด (LIVE)' : 'พักชั่วคราว (PAUSED)'}</span>
            <span className="text-[11px] font-mono text-text/50">({samples.length} ตัวอย่าง)</span>
          </div>

          {/* Interval Selector */}
          <div className="flex items-center gap-1 bg-background border border-border rounded-xl p-1 text-xs">
            <span className="text-text/60 px-1.5 font-medium flex items-center gap-1">
              <Clock className="w-3 h-3" /> ความถี่:
            </span>
            {[1000, 2000, 5000].map((ms) => (
              <button
                key={ms}
                onClick={() => setIntervalMs(ms)}
                className={`px-2 py-0.5 rounded-lg font-medium transition-all cursor-pointer ${
                  intervalMs === ms
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-text/70 hover:text-text hover:bg-card'
                }`}
              >
                {ms / 1000}s
              </button>
            ))}
          </div>

          {/* Pause / Play Button */}
          <button
            onClick={() => setIsStreaming(!isStreaming)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              isStreaming
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/20'
                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20'
            }`}
          >
            {isStreaming ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isStreaming ? 'พัก' : 'เริ่ม'}</span>
          </button>

          {/* Pulse Now Button */}
          <button
            onClick={executeLatencyPing}
            disabled={isPinging}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold px-3 py-1.5 rounded-xl text-xs shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isPinging ? 'animate-spin' : ''}`} />
            <span>Pulse Now</span>
          </button>

          {/* Export CSV */}
          <button
            onClick={handleExportCsv}
            disabled={samples.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-border hover:bg-background text-text/80 text-xs font-medium cursor-pointer"
            title="ส่งออก CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">CSV</span>
          </button>

          {/* Clear */}
          <button
            onClick={handleClearSamples}
            disabled={samples.length === 0}
            className="p-1.5 rounded-xl border border-border hover:bg-background text-text/60 hover:text-rose-500 transition-colors cursor-pointer"
            title="ล้างข้อมูลตัวอย่าง"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Dual Real-time Telemetry Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Service 1: Cloud SQL Integration Latency */}
        <div className="bg-background/80 rounded-2xl p-5 border border-border border-crisp shadow-xs space-y-4 relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-text flex items-center gap-2">
                  Cloud SQL (PostgreSQL 16)
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
                </h3>
                <span className="text-xs text-text/60">
                  Integration Latency • Round-Trip & Server Execution
                </span>
              </div>
            </div>

            <span className={`text-[11px] px-2.5 py-1 rounded-xl font-semibold border ${sqlBadge.className}`}>
              {sqlBadge.label}
            </span>
          </div>

          {/* Main Large Metric */}
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-extrabold font-mono text-text">
              {stats.cloudSql.current}
            </span>
            <span className="text-xs text-text/60 font-medium">ms (RTT)</span>
            {samples.length > 0 && samples[samples.length - 1].cloudSqlQueryDurationMs > 0 && (
              <span className="text-xs text-blue-600 dark:text-blue-400 font-mono font-medium">
                [Query: {samples[samples.length - 1].cloudSqlQueryDurationMs}ms]
              </span>
            )}
          </div>

          {/* Statistical Breakdown Grid */}
          <div className="grid grid-cols-4 gap-2 pt-2 border-t border-border/60 text-center">
            <div className="bg-card p-2 rounded-xl border border-border/60">
              <span className="text-[10px] text-text/50 uppercase block font-semibold">Min</span>
              <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                {stats.cloudSql.min} ms
              </span>
            </div>
            <div className="bg-card p-2 rounded-xl border border-border/60">
              <span className="text-[10px] text-text/50 uppercase block font-semibold">Avg</span>
              <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                {stats.cloudSql.avg} ms
              </span>
            </div>
            <div className="bg-card p-2 rounded-xl border border-border/60">
              <span className="text-[10px] text-text/50 uppercase block font-semibold">P95</span>
              <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400">
                {stats.cloudSql.p95} ms
              </span>
            </div>
            <div className="bg-card p-2 rounded-xl border border-border/60">
              <span className="text-[10px] text-text/50 uppercase block font-semibold">Jitter</span>
              <span className="font-mono text-xs font-bold text-text/70">
                ±{stats.cloudSql.jitter} ms
              </span>
            </div>
          </div>
        </div>

        {/* Service 2: Google Cloud Readiness API Latency */}
        <div className="bg-background/80 rounded-2xl p-5 border border-border border-crisp shadow-xs space-y-4 relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                <Cloud className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-text flex items-center gap-2">
                  Google Cloud Readiness API
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                </h3>
                <span className="text-xs text-text/60">
                  Direct SDK Probe • Browser to Native Readiness API
                </span>
              </div>
            </div>

            <span className={`text-[11px] px-2.5 py-1 rounded-xl font-semibold border ${fsBadge.className}`}>
              {fsBadge.label}
            </span>
          </div>

          {/* Main Large Metric */}
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-extrabold font-mono text-text">
              {stats.readiness.current}
            </span>
            <span className="text-xs text-text/60 font-medium">ms (RTT)</span>
            <span className="text-xs text-amber-600 dark:text-amber-400 font-mono font-medium">
              [Database: ai-studio-prodxpos-...]
            </span>
          </div>

          {/* Statistical Breakdown Grid */}
          <div className="grid grid-cols-4 gap-2 pt-2 border-t border-border/60 text-center">
            <div className="bg-card p-2 rounded-xl border border-border/60">
              <span className="text-[10px] text-text/50 uppercase block font-semibold">Min</span>
              <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                {stats.readiness.min} ms
              </span>
            </div>
            <div className="bg-card p-2 rounded-xl border border-border/60">
              <span className="text-[10px] text-text/50 uppercase block font-semibold">Avg</span>
              <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400">
                {stats.readiness.avg} ms
              </span>
            </div>
            <div className="bg-card p-2 rounded-xl border border-border/60">
              <span className="text-[10px] text-text/50 uppercase block font-semibold">P95</span>
              <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400">
                {stats.readiness.p95} ms
              </span>
            </div>
            <div className="bg-card p-2 rounded-xl border border-border/60">
              <span className="text-[10px] text-text/50 uppercase block font-semibold">Jitter</span>
              <span className="font-mono text-xs font-bold text-text/70">
                ±{stats.readiness.jitter} ms
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Real-time Waveform Chart (Dual SVG Traces) */}
      <div className="bg-slate-950 text-slate-100 rounded-2xl p-4 sm:p-5 border border-slate-800 shadow-inner space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo-400" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Real-time Latency Waveform (30-Point Rolling Buffer)
            </h4>
          </div>

          {/* Chart Legend */}
          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-1.5 rounded-full bg-blue-400 inline-block" />
              <span className="text-slate-300">Cloud SQL (RTT)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-1.5 rounded-full bg-amber-400 inline-block" />
              <span className="text-slate-300">Readiness API (RTT)</span>
            </div>
            <span className="text-slate-500 text-[11px]">Scale: 0 - {maxChartVal} ms</span>
          </div>
        </div>

        {/* Live SVG Graph */}
        <div className="relative w-full h-28 overflow-hidden">
          {samples.length < 2 ? (
            <div className="w-full h-full flex items-center justify-center text-xs text-slate-500 font-mono">
              กำลังรวบรวมตัวอย่างสัญญาณ Latency... (Waiting for samples)
            </div>
          ) : (
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="w-full h-full overflow-visible"
              preserveAspectRatio="none"
            >
              {/* Background horizontal grid lines */}
              <line x1="0" y1="20" x2={chartWidth} y2="20" stroke="#334155" strokeDasharray="3 3" strokeWidth="0.5" />
              <line x1="0" y1="55" x2={chartWidth} y2="55" stroke="#334155" strokeDasharray="3 3" strokeWidth="0.5" />
              <line x1="0" y1="90" x2={chartWidth} y2="90" stroke="#334155" strokeDasharray="3 3" strokeWidth="0.5" />

              {/* Cloud SQL Polyline */}
              <polyline
                fill="none"
                stroke="#60a5fa"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={sqlPoints}
              />

              {/* Readiness API Polyline */}
              <polyline
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={fsPoints}
              />

              {/* Dots on last points */}
              {samples.length > 0 && (
                <>
                  <circle
                    cx={chartWidth}
                    cy={chartHeight - (Math.min(samples[samples.length - 1].cloudSqlRttMs, maxChartVal) / maxChartVal) * (chartHeight - 15) - 8}
                    r="4"
                    fill="#60a5fa"
                  />
                  <circle
                    cx={chartWidth}
                    cy={chartHeight - (Math.min(samples[samples.length - 1].readinessRttMs, maxChartVal) / maxChartVal) * (chartHeight - 15) - 8}
                    r="4"
                    fill="#f59e0b"
                  />
                </>
              )}
            </svg>
          )}
        </div>

        {/* Bottom time markers */}
        {samples.length > 0 && (
          <div className="flex justify-between text-[10px] font-mono text-slate-500 pt-1 border-t border-slate-900">
            <span>{samples[0]?.timeStr}</span>
            <span>{samples[Math.floor(samples.length / 2)]?.timeStr}</span>
            <span>{samples[samples.length - 1]?.timeStr} (ล่าสุด)</span>
          </div>
        )}
      </div>

      {/* Recent Ping Telemetry Log Table */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold text-text">
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-500" />
            ตารางบันทึกการส่ง Ping ล่าสุด (High-Resolution performance.now() Log)
          </span>
          <span className="text-text/50 font-mono text-[11px]">
            {samples.length > 0 ? `แสดง ${Math.min(6, samples.length)} รายการล่าสุด` : ''}
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border border-crisp">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-background/80 text-text/60 border-b border-border">
              <tr>
                <th className="py-2 px-3">#</th>
                <th className="py-2 px-3">Timestamp</th>
                <th className="py-2 px-3">performance.now() Start</th>
                <th className="py-2 px-3 text-blue-600 dark:text-blue-400">Cloud SQL RTT</th>
                <th className="py-2 px-3 text-blue-600 dark:text-blue-400">Query Time</th>
                <th className="py-2 px-3 text-amber-600 dark:text-amber-400">Readiness API RTT</th>
                <th className="py-2 px-3">Transit Overhead</th>
                <th className="py-2 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {samples.slice(-6).reverse().map((s) => (
                <tr key={s.id} className="hover:bg-background/50 transition-colors">
                  <td className="py-2 px-3 font-bold text-text/80">{s.sampleIndex}</td>
                  <td className="py-2 px-3 text-text/70">{s.timeStr}</td>
                  <td className="py-2 px-3 text-text/50 text-[11px]">{s.clientSentPerfNow.toFixed(1)}ms</td>
                  <td className="py-2 px-3 font-bold text-blue-600 dark:text-blue-400">{s.cloudSqlRttMs} ms</td>
                  <td className="py-2 px-3 text-text/70">{s.cloudSqlQueryDurationMs} ms</td>
                  <td className="py-2 px-3 font-bold text-amber-600 dark:text-amber-400">{s.readinessRttMs} ms</td>
                  <td className="py-2 px-3 text-text/60">{s.networkTransitMs} ms</td>
                  <td className="py-2 px-3">
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-semibold ${
                        s.cloudSqlStatus === 'ok' && s.readinessStatus === 'ok'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {s.cloudSqlStatus === 'ok' && s.readinessStatus === 'ok' ? 'OK (200)' : 'DEGRADED'}
                    </span>
                  </td>
                </tr>
              ))}
              {samples.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-text/50">
                    ยังไม่มีข้อมูลตัวอย่าง (กำลังเชื่อมต่อและส่งสัญญาณ Ping...)
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
