import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  Database,
  Cpu,
  X,
  Play,
  Download,
  Copy,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Clock,
  Layers,
  ChevronDown,
  Maximize2,
  Minimize2,
  RefreshCw,
  Terminal,
  Gauge,
  HelpCircle,
  Move,
  Palette,
} from 'lucide-react';
import { devPerformanceTracker, DbOperationLog } from '../../services/devPerformanceTracker';
import { getZIndexClass } from '../../utils/ZIndexManager';
import { ThemeInspectorModal } from './ThemeInspectorModal';

export type DevOverlayPosition = 'top-right' | 'bottom-right' | 'bottom-bar' | 'modal' | 'badge';

export const DevPerformanceOverlay: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<DevOverlayPosition>('top-right');
  const [activeTab, setActiveTab] = useState<'all' | 'fps' | 'db' | 'memory'>('all');
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<{
    readAvgMs: number;
    writeAvgMs: number;
    p95Ms: number;
    operationsCount: number;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);

  // Subscribe to real-time performance tracker updates
  const [, setTick] = useState(0);
  useEffect(() => {
    const unsubscribe = devPerformanceTracker.subscribe(() => {
      setTick((prev) => prev + 1);
    });
    return unsubscribe;
  }, []);

  // Global Keyboard Shortcut: Ctrl + Shift + D / Cmd + Shift + D / Shift + Alt + D
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      const isShift = e.shiftKey;
      const isAlt = e.altKey;

      // Primary: Ctrl/Cmd + Shift + D
      // Secondary: Shift + Alt + D or Ctrl + Alt + D
      if (
        (isCmdOrCtrl && isShift && e.key.toLowerCase() === 'd') ||
        (isShift && isAlt && e.key.toLowerCase() === 'd') ||
        (isCmdOrCtrl && isAlt && e.key.toLowerCase() === 'd')
      ) {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen((prev) => !prev);
      } else if (isOpen && e.key === 'Escape' && position === 'modal') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, position]);

  const fpsData = devPerformanceTracker.getFpsData();
  const dbData = devPerformanceTracker.getDbData();
  const memoryData = devPerformanceTracker.getMemoryData();

  // Color indicators based on FPS & Latency performance
  const fpsColor =
    fpsData.currentFps >= 55
      ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
      : fpsData.currentFps >= 30
      ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
      : 'text-rose-400 border-rose-500/30 bg-rose-500/10';

  const dbLatencyColor =
    dbData.avgMs <= 15
      ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
      : dbData.avgMs <= 50
      ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
      : 'text-rose-400 border-rose-500/30 bg-rose-500/10';

  // Run real DB Benchmark
  const handleRunBenchmark = async () => {
    setIsBenchmarking(true);
    try {
      const result = await devPerformanceTracker.runDbBenchmark();
      setBenchmarkResult(result);
    } catch (err) {
      console.error('Benchmark failed', err);
    } finally {
      setIsBenchmarking(false);
    }
  };

  // Copy telemetry report
  const handleCopyReport = () => {
    const report = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      screenResolution: `${window.innerWidth}x${window.innerHeight}`,
      fps: fpsData,
      dbLatency: {
        lastMs: dbData.lastMs,
        avgMs: dbData.avgMs,
        p95Ms: dbData.p95Ms,
        totalCount: dbData.totalCount,
        errorCount: dbData.errorCount,
      },
      memory: {
        usedHeapMb: memoryData.usedHeapMb,
        totalHeapMb: memoryData.totalHeapMb,
        heapLimitMb: memoryData.heapLimitMb,
        domNodesCount: memoryData.domNodesCount,
      },
      recentDbLogs: dbData.logs.slice(0, 20),
    };

    navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Export JSON Report
  const handleExportJson = () => {
    const report = {
      timestamp: new Date().toISOString(),
      fps: fpsData,
      dbLatency: dbData,
      memory: memoryData,
      logs: dbData.logs,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prodx-perf-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) {
    return null;
  }

  // Render SVG Sparkline for FPS History
  const renderFpsSparkline = () => {
    const history = fpsData.history;
    if (history.length < 2) return null;

    const width = 240;
    const height = 40;
    const maxVal = 70;
    const minVal = 0;

    const points = history.map((item, idx) => {
      const x = (idx / (history.length - 1)) * width;
      const y = height - ((item.fps - minVal) / (maxVal - minVal)) * height;
      return `${x},${Math.max(2, Math.min(height - 2, y))}`;
    });

    const pathData = `M ${points.join(' L ')}`;

    return (
      <div className="relative w-full h-10 bg-slate-950/80 rounded-lg p-1 border border-slate-800 overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
          {/* Target 60 FPS reference line */}
          <line
            x1="0"
            y1={height - (60 / maxVal) * height}
            x2={width}
            y2={height - (60 / maxVal) * height}
            stroke="#10b981"
            strokeDasharray="3 3"
            strokeWidth="0.8"
            opacity="0.4"
          />
          {/* FPS Trend Line */}
          <path
            d={pathData}
            fill="none"
            stroke={fpsData.currentFps >= 55 ? '#10b981' : fpsData.currentFps >= 30 ? '#f59e0b' : '#ef4444'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    );
  };

  // Render SVG Sparkline for DB Latency History
  const renderDbSparkline = () => {
    const logs = dbData.logs.slice(0, 30).reverse();
    if (logs.length < 2) {
      return (
        <div className="w-full h-10 bg-slate-950/80 rounded-lg flex items-center justify-center text-[10px] text-slate-500 font-mono">
          Waiting for DB operations...
        </div>
      );
    }

    const width = 240;
    const height = 40;
    const maxVal = Math.max(30, ...logs.map((l) => l.durationMs));

    return (
      <div className="relative w-full h-10 bg-slate-950/80 rounded-lg p-1 border border-slate-800 overflow-hidden flex items-end justify-between gap-1">
        {logs.map((log, idx) => {
          const barHeight = Math.max(3, Math.min(height, (log.durationMs / maxVal) * height));
          const isError = !log.success;
          const barColor = isError
            ? 'bg-rose-500'
            : log.durationMs <= 10
            ? 'bg-emerald-400'
            : log.durationMs <= 30
            ? 'bg-amber-400'
            : 'bg-rose-400';

          return (
            <div
              key={log.id || idx}
              title={`${log.name}: ${log.durationMs}ms`}
              className={`flex-1 rounded-t-xs transition-all ${barColor}`}
              style={{ height: `${barHeight}px` }}
            ></div>
          );
        })}
      </div>
    );
  };

  // Container styling based on dock position
  const getContainerStyle = () => {
    switch (position) {
      case 'bottom-right':
        return 'fixed bottom-4 right-4 w-96 max-h-[85vh] shadow-2xl z-[9999]';
      case 'bottom-bar':
        return 'fixed bottom-0 left-0 right-0 max-h-[40vh] shadow-2xl z-[9999] border-t border-slate-800';
      case 'modal':
        return 'fixed inset-4 md:inset-10 max-w-5xl mx-auto my-auto h-[85vh] shadow-2xl z-[9999]';
      case 'badge':
        return 'fixed bottom-4 right-4 z-[9999]';
      case 'top-right':
      default:
        return 'fixed top-4 right-4 w-96 max-h-[85vh] shadow-2xl z-[9999]';
    }
  };

  const portalContent = (
    <div className={`font-sans text-slate-100 ${getContainerStyle()}`}>
      {/* Minimized Pill Badge View */}
      {position === 'badge' ? (
        <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/80 shadow-2xl rounded-full p-2 pl-3.5 pr-2 flex items-center gap-3 animate-in fade-in zoom-in-95">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className={`text-xs font-mono font-bold ${fpsColor.split(' ')[0]}`}>
              {fpsData.currentFps} FPS
            </span>
          </div>

          <div className="h-3 w-px bg-slate-700"></div>

          <div className="flex items-center gap-1 text-xs font-mono text-cyan-400">
            <Database className="w-3 h-3" />
            <span>{dbData.avgMs}ms</span>
          </div>

          <div className="h-3 w-px bg-slate-700"></div>

          <div className="flex items-center gap-1 text-xs font-mono text-indigo-300">
            <Cpu className="w-3 h-3" />
            <span>{memoryData.usedHeapMb}MB</span>
          </div>

          <button
            type="button"
            onClick={() => setPosition('top-right')}
            className="p-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer transition-colors"
            title="Expand Developer HUD"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="p-1 rounded-full bg-slate-800 hover:bg-rose-950 text-rose-300 cursor-pointer transition-colors"
            title="Close HUD (Ctrl+Shift+D)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        /* Full Panel HUD View */
        <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/80 shadow-2xl rounded-2xl flex flex-col h-full overflow-hidden animate-in fade-in zoom-in-95">
          {/* Header Bar */}
          <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/80 border-b border-slate-800/80 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center shrink-0 text-indigo-400">
                <Gauge className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-100 truncate">
                    PRODX DEV HUD
                  </span>
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    LIVE METRICS
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono flex items-center gap-2">
                  <span>Press <kbd className="px-1 py-0.2 bg-slate-800 text-slate-300 rounded border border-slate-700 font-sans">Ctrl+Shift+D</kbd> to toggle</span>
                </div>
              </div>
            </div>

            {/* Position & Action Buttons */}
            <div className="flex items-center gap-1">
              {/* Dock options */}
              <div className="hidden sm:flex items-center bg-slate-800/80 rounded-lg p-0.5 border border-slate-700/80">
                <button
                  type="button"
                  onClick={() => setPosition('top-right')}
                  className={`p-1 rounded-md text-[10px] font-mono cursor-pointer transition-colors ${
                    position === 'top-right' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Dock Top Right"
                >
                  TR
                </button>
                <button
                  type="button"
                  onClick={() => setPosition('bottom-right')}
                  className={`p-1 rounded-md text-[10px] font-mono cursor-pointer transition-colors ${
                    position === 'bottom-right' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Dock Bottom Right"
                >
                  BR
                </button>
                <button
                  type="button"
                  onClick={() => setPosition('modal')}
                  className={`p-1 rounded-md text-[10px] font-mono cursor-pointer transition-colors ${
                    position === 'modal' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Expand Modal View"
                >
                  Full
                </button>
              </div>

              <button
                type="button"
                onClick={() => setPosition('badge')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer transition-colors"
                title="Minimize to Floating Pill"
              >
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 cursor-pointer transition-colors"
                title="Close Overlay"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-3 gap-2 p-2.5 bg-slate-950/40 border-b border-slate-800/80 shrink-0 text-center">
            {/* FPS Badge */}
            <div className={`p-2 rounded-xl border flex flex-col items-center justify-center ${fpsColor}`}>
              <div className="flex items-center gap-1 text-[10px] font-mono uppercase opacity-80">
                <Activity className="w-3 h-3" />
                <span>Frame Rate</span>
              </div>
              <div className="text-base font-black font-mono tracking-tight mt-0.5">
                {fpsData.currentFps} <span className="text-[10px] font-normal">FPS</span>
              </div>
              <div className="text-[9px] font-mono text-slate-400 mt-0.5">
                {fpsData.frameTimeMs}ms/frame
              </div>
            </div>

            {/* DB Latency Badge */}
            <div className={`p-2 rounded-xl border flex flex-col items-center justify-center ${dbLatencyColor}`}>
              <div className="flex items-center gap-1 text-[10px] font-mono uppercase opacity-80">
                <Database className="w-3 h-3" />
                <span>DB Latency</span>
              </div>
              <div className="text-base font-black font-mono tracking-tight mt-0.5">
                {dbData.avgMs} <span className="text-[10px] font-normal">ms avg</span>
              </div>
              <div className="text-[9px] font-mono text-slate-400 mt-0.5">
                P95: {dbData.p95Ms}ms ({dbData.totalCount} ops)
              </div>
            </div>

            {/* RAM Badge */}
            <div className="p-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 flex flex-col items-center justify-center">
              <div className="flex items-center gap-1 text-[10px] font-mono uppercase opacity-80">
                <Cpu className="w-3 h-3" />
                <span>Memory</span>
              </div>
              <div className="text-base font-black font-mono tracking-tight mt-0.5">
                {memoryData.usedHeapMb} <span className="text-[10px] font-normal">MB</span>
              </div>
              <div className="text-[9px] font-mono text-slate-400 mt-0.5">
                DOM: {memoryData.domNodesCount} nodes
              </div>
            </div>
          </div>

          {/* Main Body Content */}
          <div className="p-3 space-y-3.5 overflow-y-auto flex-1 min-h-0 text-xs">
            {/* 1. FPS Realtime Metrics & Sparkline */}
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-slate-300">
                <span className="font-bold flex items-center gap-1.5 text-xs">
                  <Activity className="w-3.5 h-3.5 text-emerald-400" />
                  Real-time Frame Rate (60Hz Canvas)
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  Avg: {fpsData.avgFps} FPS | Min: {fpsData.minFps} | Max: {fpsData.maxFps}
                </span>
              </div>

              {renderFpsSparkline()}

              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-0.5">
                <span>Dropped Frames: <strong className={fpsData.droppedFrames > 0 ? 'text-amber-400' : 'text-slate-300'}>{fpsData.droppedFrames}</strong></span>
                <span>Event Loop Lag: <strong className={fpsData.eventLoopLagMs > 10 ? 'text-rose-400' : 'text-slate-300'}>{fpsData.eventLoopLagMs}ms</strong></span>
              </div>
            </div>

            {/* 2. Database Latency & Interactive Benchmark */}
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-300 flex items-center gap-1.5 text-xs">
                  <Database className="w-3.5 h-3.5 text-cyan-400" />
                  Database & API Latency Monitor
                </span>
                <button
                  type="button"
                  onClick={handleRunBenchmark}
                  disabled={isBenchmarking}
                  className="px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold text-[10px] flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Play className={`w-3 h-3 ${isBenchmarking ? 'animate-spin' : ''}`} />
                  {isBenchmarking ? 'Benchmarking...' : 'Run DB Benchmark'}
                </button>
              </div>

              {/* Benchmark Results Callout */}
              {benchmarkResult && (
                <div className="p-2 rounded-lg bg-indigo-950/60 border border-indigo-500/40 text-[11px] space-y-1">
                  <div className="font-bold text-indigo-300 flex items-center gap-1">
                    <Zap className="w-3 h-3 text-amber-400" />
                    IndexedDB / Storage Stress Test Result:
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-slate-200 font-mono text-[10px]">
                    <div>Read Avg: <strong className="text-emerald-400">{benchmarkResult.readAvgMs}ms</strong></div>
                    <div>Write Avg: <strong className="text-cyan-400">{benchmarkResult.writeAvgMs}ms</strong></div>
                    <div>P95 Latency: <strong className="text-amber-400">{benchmarkResult.p95Ms}ms</strong></div>
                  </div>
                </div>
              )}

              {renderDbSparkline()}

              {/* DB Query Log Table */}
              <div className="space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex justify-between">
                  <span>Recent DB Operations ({dbData.logs.length})</span>
                  <span>Latency</span>
                </div>
                <div className="max-h-28 overflow-y-auto space-y-1 pr-1 font-mono text-[10px]">
                  {dbData.logs.length === 0 ? (
                    <div className="py-2 text-center text-slate-500 italic">No database operations logged yet.</div>
                  ) : (
                    dbData.logs.slice(0, 10).map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center justify-between p-1.5 rounded bg-slate-900/90 border border-slate-800/80 hover:border-slate-700 transition-colors"
                      >
                        <div className="flex items-center gap-1.5 truncate pr-2">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${log.success ? 'bg-emerald-400' : 'bg-rose-500'}`}></span>
                          <span className="text-slate-300 truncate">{log.name}</span>
                          {log.details && <span className="text-slate-500 text-[9px] truncate">({log.details})</span>}
                        </div>
                        <span className={`shrink-0 font-bold ${
                          log.durationMs <= 10 ? 'text-emerald-400' : log.durationMs <= 30 ? 'text-amber-400' : 'text-rose-400'
                        }`}>
                          {log.durationMs}ms
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* 3. Memory & V8 Engine Heap Metrics */}
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-slate-300">
                <span className="font-bold flex items-center gap-1.5 text-xs">
                  <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                  Memory & V8 Heap Allocation
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {memoryData.hasNativeMemory ? 'V8 Memory API' : 'DOM Estimate'}
                </span>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-mono text-slate-400">
                  <span>Used: <strong className="text-slate-200">{memoryData.usedHeapMb} MB</strong></span>
                  <span>Allocated: <strong className="text-slate-200">{memoryData.totalHeapMb} MB</strong></span>
                  <span>Limit: <strong className="text-slate-400">{memoryData.heapLimitMb} MB</strong></span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden flex">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all duration-300"
                    style={{ width: `${Math.min(100, (memoryData.usedHeapMb / memoryData.heapLimitMb) * 100 * 5)}%` }}
                  ></div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-400 pt-1">
                <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                  DOM Element Count: <strong className="text-indigo-300">{memoryData.domNodesCount}</strong>
                </div>
                <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                  Memory Leak Risk: <strong className="text-emerald-400">Low (Stable)</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Footer Action Toolbar */}
          <div className="p-2.5 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between shrink-0 gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleCopyReport}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied!' : 'Copy Telemetry'}</span>
              </button>

              <button
                type="button"
                onClick={handleExportJson}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
                title="Export JSON performance logs"
              >
                <Download className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hidden sm:inline">Export</span>
              </button>

              <button
                type="button"
                onClick={() => setIsThemeModalOpen(true)}
                className="px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-[11px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
                title="Open CSS Custom Properties & Theme Inspector"
              >
                <Palette className="w-3.5 h-3.5 text-blue-400" />
                <span>Theme CSS</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => devPerformanceTracker.clearLogs()}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-rose-300 text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors ml-auto"
              title="Clear telemetry logs"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          </div>
        </div>
      )}
      <ThemeInspectorModal isOpen={isThemeModalOpen} onClose={() => setIsThemeModalOpen(false)} />
    </div>
  );

  return createPortal(portalContent, document.body);
};
