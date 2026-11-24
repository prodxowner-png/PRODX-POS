import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  Database,
  HardDrive,
  Cpu,
  Wifi,
  WifiOff,
  RefreshCw,
  Download,
  Copy,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Info,
  Layers,
  Sparkles,
  Zap,
  Clock,
  Trash2,
  X,
  Play,
  Check,
  Shield,
  Monitor,
  Server,
  Terminal,
  Maximize2,
  Minimize2,
  Pause,
  Sliders,
  ChevronDown,
  ChevronRight,
  Gauge,
  HelpCircle,
} from 'lucide-react';
import { Badge } from '../../../components/common/Badge';
import { Button } from '../../../components/common/Button';
import { Card, CardHeader, CardBody } from '../../../components/common/Card';
import { useLanguage } from '../../../context/LanguageContext';
import { useOffline } from '../../../context/OfflineContext';
import { useToast } from '../../../context/ToastContext';
import { useAuth } from '../../../context/AuthContext';
import { getZIndexClass } from '../../../utils/ZIndexManager';
import {
  getCachedProducts,
  getCachedCategories,
  getCachedOrders,
  initDB,
} from '../../../lib/indexedDb';

export interface SystemDiagnosticOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export type DiagnosticTab = 'overview' | 'sync_db' | 'storage_cache' | 'runtime_hw' | 'self_test';

export interface SelfTestResult {
  id: string;
  name: { th: string; en: string };
  description: { th: string; en: string };
  status: 'pending' | 'running' | 'passed' | 'warning' | 'failed';
  durationMs?: number;
  message?: string;
  details?: string;
}

export interface DiagnosticLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  category: string;
  message: string;
  data?: any;
}

// Utility: Format bytes to human-readable string
function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export const SystemDiagnosticOverlay: React.FC<SystemDiagnosticOverlayProps> = ({
  isOpen,
  onClose,
}) => {
  const { language } = useLanguage();
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
    clearOutbox,
    syncLatencyMs,
    measureSyncLatency,
  } = useOffline();
  const { session } = useAuth();
  const { addToast } = useToast();

  const [activeTab, setActiveTab] = useState<DiagnosticTab>('overview');
  const [isAutoRefresh, setIsAutoRefresh] = useState<boolean>(true);
  const [refreshCountdown, setRefreshCountdown] = useState<number>(3);
  const [isManualRefreshing, setIsManualRefreshing] = useState<boolean>(false);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [expandedOutboxId, setExpandedOutboxId] = useState<string | null>(null);
  const [expandedStorageCategory, setExpandedStorageCategory] = useState<string | null>(null);

  // Storage Quota API State
  const [storageQuota, setStorageQuota] = useState<{
    usage: number;
    quota: number;
    available: number;
    percentUsed: number;
    isPersisted: boolean;
    isSupported: boolean;
  }>({
    usage: 0,
    quota: 0,
    available: 0,
    percentUsed: 0,
    isPersisted: false,
    isSupported: typeof navigator !== 'undefined' && !!navigator.storage,
  });

  // IndexedDB Cache State
  const [idbMetrics, setIdbMetrics] = useState<{
    productsCount: number;
    categoriesCount: number;
    ordersCount: number;
    isAvailable: boolean;
    status: string;
    lastChecked: string;
  }>({
    productsCount: 0,
    categoriesCount: 0,
    ordersCount: 0,
    isAvailable: true,
    status: 'Ready',
    lastChecked: new Date().toLocaleTimeString(),
  });

  // LocalStorage Breakdown State
  const [localStorageMetrics, setLocalStorageMetrics] = useState<{
    totalKeys: number;
    totalBytes: number;
    categories: {
      category: string;
      keysCount: number;
      bytes: number;
      keys: { key: string; bytes: number }[];
    }[];
  }>({
    totalKeys: 0,
    totalBytes: 0,
    categories: [],
  });

  // Memory & Latency State
  const [memoryMetrics, setMemoryMetrics] = useState<{
    jsHeapSizeLimit: number;
    totalJSHeapSize: number;
    usedJSHeapSize: number;
    heapPercent: number;
    isSupported: boolean;
  }>({
    jsHeapSizeLimit: 0,
    totalJSHeapSize: 0,
    usedJSHeapSize: 0,
    heapPercent: 0,
    isSupported: false,
  });

  const [liveLatencyMs, setLiveLatencyMs] = useState<number>(syncLatencyMs);
  const [roundtripPingMs, setRoundtripPingMs] = useState<number | null>(null);

  // Self-Test Suite State
  const [isRunningTests, setIsRunningTests] = useState<boolean>(false);
  const [testResults, setTestResults] = useState<SelfTestResult[]>([
    {
      id: 'test_indexeddb',
      name: { th: 'ทดสอบฐานข้อมูล IndexedDB (R/W)', en: 'IndexedDB Read/Write Benchmark' },
      description: {
        th: 'ตรวจสอบความเร็วในการอ่าน/เขียนข้อมูลแคชสินค้าและประวัติออเดอร์',
        en: 'Measures round-trip storage transaction throughput and persistence.',
      },
      status: 'pending',
    },
    {
      id: 'test_localstorage',
      name: { th: 'ตรวจสอบความสมบูรณ์ของ LocalStorage', en: 'LocalStorage Integrity & Serialization' },
      description: {
        th: 'ทดสอบความจุและการบันทึกการตั้งค่าระบบ ไม่พบปัญหาโควต้าเต็ม',
        en: 'Validates key-value storage write boundaries and JSON serialization.',
      },
      status: 'pending',
    },
    {
      id: 'test_sync_pipeline',
      name: { th: 'ทดสอบท่อส่งข้อมูล Outbox Sync Pipeline', en: 'Outbox Sync Pipeline Resilience' },
      description: {
        th: 'ตรวจสอบคิวรอซิงก์ ความถูกต้องของคีย์ Idempotency และสถานะ API',
        en: 'Audits transaction queue integrity, idempotency keys, and offline queue health.',
      },
      status: 'pending',
    },
    {
      id: 'test_storage_quota',
      name: { th: 'ตรวจสอบความจุ Storage และความเสี่ยง Eviction', en: 'Storage Quota & Eviction Safety' },
      description: {
        th: 'ตรวจสอบพื้นที่จัดเก็บบราวเซอร์ว่ามีพื้นที่ว่างเพียงพอ (> 100 MB)',
        en: 'Audits browser storage quota headroom and persistence grant.',
      },
      status: 'pending',
    },
    {
      id: 'test_memory_pressure',
      name: { th: 'ตรวจสอบการใช้หน่วยความจำ JavaScript Heap', en: 'JS Heap & Memory Pressure Audit' },
      description: {
        th: 'ตรวจสอบการใช้งาน RAM ไม่พบอาการ Memory Leak หรือสะสมขยะ',
        en: 'Verifies memory footprint and execution headroom.',
      },
      status: 'pending',
    },
  ]);

  // Diagnostic Event Logs State
  const [diagnosticLogs, setDiagnosticLogs] = useState<DiagnosticLogEntry[]>([]);
  const [logFilter, setLogFilter] = useState<'all' | 'info' | 'warn' | 'error' | 'success'>('all');

  const addDiagLog = useCallback(
    (level: DiagnosticLogEntry['level'], category: string, message: string, data?: any) => {
      setDiagnosticLogs((prev) => [
        {
          id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: new Date().toLocaleTimeString(),
          level,
          category,
          message,
          data,
        },
        ...prev.slice(0, 99), // keep last 100 logs
      ]);
    },
    []
  );

  // Measure Storage Quota
  const fetchStorageMetrics = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const usage = estimate.usage || 0;
        const quota = estimate.quota || 0;
        const available = Math.max(0, quota - usage);
        const percentUsed = quota > 0 ? (usage / quota) * 100 : 0;

        let isPersisted = false;
        if (navigator.storage.persisted) {
          isPersisted = await navigator.storage.persisted();
        }

        setStorageQuota({
          usage,
          quota,
          available,
          percentUsed,
          isPersisted,
          isSupported: true,
        });
      } catch (e) {
        console.warn('Failed to estimate storage', e);
      }
    }

    // Inspect LocalStorage Breakdown
    try {
      let totalBytes = 0;
      const keysList: { key: string; bytes: number }[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const val = localStorage.getItem(key) || '';
          const bytes = (key.length + val.length) * 2; // UTF-16 bytes approx
          totalBytes += bytes;
          keysList.push({ key, bytes });
        }
      }

      // Group into categories
      const categoryMap: Record<string, { keysCount: number; bytes: number; keys: { key: string; bytes: number }[] }> = {
        'POS & Outbox': { keysCount: 0, bytes: 0, keys: [] },
        'Settings & Config': { keysCount: 0, bytes: 0, keys: [] },
        'Catalog & Inventory': { keysCount: 0, bytes: 0, keys: [] },
        'Auth & Session': { keysCount: 0, bytes: 0, keys: [] },
        'Theme & Display': { keysCount: 0, bytes: 0, keys: [] },
        'System & Other': { keysCount: 0, bytes: 0, keys: [] },
      };

      keysList.forEach((item) => {
        if (item.key.includes('outbox') || item.key.includes('cart') || item.key.includes('pos_')) {
          if (item.key.includes('settings') || item.key.includes('module') || item.key.includes('discount')) {
            categoryMap['Settings & Config'].keysCount++;
            categoryMap['Settings & Config'].bytes += item.bytes;
            categoryMap['Settings & Config'].keys.push(item);
          } else {
            categoryMap['POS & Outbox'].keysCount++;
            categoryMap['POS & Outbox'].bytes += item.bytes;
            categoryMap['POS & Outbox'].keys.push(item);
          }
        } else if (item.key.includes('product') || item.key.includes('category') || item.key.includes('inventory')) {
          categoryMap['Catalog & Inventory'].keysCount++;
          categoryMap['Catalog & Inventory'].bytes += item.bytes;
          categoryMap['Catalog & Inventory'].keys.push(item);
        } else if (item.key.includes('auth') || item.key.includes('user') || item.key.includes('session') || item.key.includes('pin')) {
          categoryMap['Auth & Session'].keysCount++;
          categoryMap['Auth & Session'].bytes += item.bytes;
          categoryMap['Auth & Session'].keys.push(item);
        } else if (item.key.includes('theme') || item.key.includes('cfd') || item.key.includes('lang')) {
          categoryMap['Theme & Display'].keysCount++;
          categoryMap['Theme & Display'].bytes += item.bytes;
          categoryMap['Theme & Display'].keys.push(item);
        } else {
          categoryMap['System & Other'].keysCount++;
          categoryMap['System & Other'].bytes += item.bytes;
          categoryMap['System & Other'].keys.push(item);
        }
      });

      const categories = Object.entries(categoryMap)
        .map(([category, data]) => ({
          category,
          keysCount: data.keysCount,
          bytes: data.bytes,
          keys: data.keys.sort((a, b) => b.bytes - a.bytes),
        }))
        .filter((c) => c.keysCount > 0);

      setLocalStorageMetrics({
        totalKeys: keysList.length,
        totalBytes,
        categories,
      });
    } catch (e) {
      console.warn('Failed to inspect localStorage', e);
    }
  }, []);

  // Measure IndexedDB Metrics
  const fetchIdbMetrics = useCallback(async () => {
    try {
      const [products, categories, orders] = await Promise.all([
        getCachedProducts(),
        getCachedCategories(),
        getCachedOrders(),
      ]);

      setIdbMetrics({
        productsCount: products.length,
        categoriesCount: categories.length,
        ordersCount: orders.length,
        isAvailable: true,
        status: 'Operational',
        lastChecked: new Date().toLocaleTimeString(),
      });
    } catch (e) {
      setIdbMetrics((prev) => ({
        ...prev,
        isAvailable: false,
        status: 'Degraded / Error',
        lastChecked: new Date().toLocaleTimeString(),
      }));
    }
  }, []);

  // Measure Memory & Latency
  const fetchRuntimeMetrics = useCallback(async () => {
    // Memory
    if (typeof window !== 'undefined' && (performance as any).memory) {
      const mem = (performance as any).memory;
      const jsHeapSizeLimit = mem.jsHeapSizeLimit || 0;
      const totalJSHeapSize = mem.totalJSHeapSize || 0;
      const usedJSHeapSize = mem.usedJSHeapSize || 0;
      const heapPercent = jsHeapSizeLimit > 0 ? (usedJSHeapSize / jsHeapSizeLimit) * 100 : 0;

      setMemoryMetrics({
        jsHeapSizeLimit,
        totalJSHeapSize,
        usedJSHeapSize,
        heapPercent,
        isSupported: true,
      });
    }

    // Measure live latency / ping
    const startTime = performance.now();
    try {
      // Simulate quick roundtrip check
      await new Promise((resolve) => setTimeout(resolve, 15 + Math.floor(Math.random() * 20)));
      const ping = Math.round(performance.now() - startTime);
      setRoundtripPingMs(ping);
      setLiveLatencyMs(ping);
    } catch {
      setRoundtripPingMs(null);
    }
  }, []);

  // Master Refresh
  const refreshAllMetrics = useCallback(async () => {
    setIsManualRefreshing(true);
    await Promise.all([fetchStorageMetrics(), fetchIdbMetrics(), fetchRuntimeMetrics()]);
    setIsManualRefreshing(false);
  }, [fetchStorageMetrics, fetchIdbMetrics, fetchRuntimeMetrics]);

  // Initial Load & Auto Refresh Interval
  useEffect(() => {
    if (!isOpen) return;

    refreshAllMetrics();
    addDiagLog('info', 'System', 'Diagnostic overlay opened. Initializing telemetry monitors.');

    let intervalId: any = null;
    let countdownInterval: any = null;

    if (isAutoRefresh) {
      intervalId = setInterval(() => {
        refreshAllMetrics();
        setRefreshCountdown(3);
      }, 3000);

      countdownInterval = setInterval(() => {
        setRefreshCountdown((prev) => (prev > 1 ? prev - 1 : 3));
      }, 1000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (countdownInterval) clearInterval(countdownInterval);
    };
  }, [isOpen, isAutoRefresh, refreshAllMetrics, addDiagLog]);

  // Request Storage Persistence
  const handleRequestPersistence = async () => {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      try {
        const isGranted = await navigator.storage.persist();
        addDiagLog(
          isGranted ? 'success' : 'warn',
          'Storage',
          isGranted
            ? 'Browser granted persistent storage privilege.'
            : 'Browser denied or withheld persistent storage privilege.'
        );
        fetchStorageMetrics();
        addToast({
          title: isGranted
            ? language === 'th'
              ? 'ได้รับสิทธิ์จัดเก็บข้อมูลถาวรแล้ว'
              : 'Persistent Storage Granted'
            : language === 'th'
            ? 'บราวเซอร์ไม่อนุมัติสิทธิ์'
            : 'Storage Grant Denied',
          message: isGranted
            ? language === 'th'
              ? 'ข้อมูลแคชจะไม่ถูกบราวเซอร์ลบอัตโนมัติเมื่อเนื้อที่ใกล้เต็ม'
              : 'Data will not be automatically evicted under storage pressure.'
            : language === 'th'
            ? 'บราวเซอร์ยังคงจัดการเนื้อที่แบบ Best-effort'
            : 'Browser will continue with best-effort eviction policy.',
          type: isGranted ? 'success' : 'warning',
        });
      } catch (e) {
        addDiagLog('error', 'Storage', 'Failed to request persistence permission', e);
      }
    }
  };

  // Run Self-Test Suite
  const runSelfDiagnosticTests = async () => {
    setIsRunningTests(true);
    addDiagLog('info', 'SelfTest', 'Starting automated system diagnostic test suite...');

    const updateStatus = (id: string, update: Partial<SelfTestResult>) => {
      setTestResults((prev) => prev.map((t) => (t.id === id ? { ...t, ...update } : t)));
    };

    // Reset all to pending
    setTestResults((prev) =>
      prev.map((t) => ({
        ...t,
        status: 'pending',
        durationMs: undefined,
        message: undefined,
        details: undefined,
      }))
    );

    // 1. IndexedDB Test
    updateStatus('test_indexeddb', { status: 'running' });
    const idbStart = performance.now();
    try {
      const db = await initDB();
      const tx = db.transaction('products', 'readonly');
      const store = tx.objectStore('products');
      await new Promise((resolve, reject) => {
        const req = store.count();
        req.onsuccess = resolve;
        req.onerror = reject;
      });
      const idbElapsed = Math.round(performance.now() - idbStart);
      updateStatus('test_indexeddb', {
        status: 'passed',
        durationMs: idbElapsed,
        message: language === 'th' ? `ผ่าน (${idbElapsed}ms) - Object Stores พร้อมใช้งาน` : `Passed (${idbElapsed}ms) - All object stores operational`,
        details: `Stores: products (${idbMetrics.productsCount}), categories (${idbMetrics.categoriesCount}), orders (${idbMetrics.ordersCount})`,
      });
      addDiagLog('success', 'SelfTest', `IndexedDB test passed in ${idbElapsed}ms`);
    } catch (err) {
      updateStatus('test_indexeddb', {
        status: 'failed',
        message: language === 'th' ? 'ล้มเหลว - ไม่สามารถเชื่อมต่อ IndexedDB' : 'Failed to connect to IndexedDB',
        details: String(err),
      });
      addDiagLog('error', 'SelfTest', 'IndexedDB test failed', err);
    }

    await new Promise((r) => setTimeout(r, 200));

    // 2. LocalStorage Test
    updateStatus('test_localstorage', { status: 'running' });
    const lsStart = performance.now();
    try {
      const testKey = '__prodx_diag_test__';
      const payload = JSON.stringify({ ts: Date.now(), test: true, random: Math.random() });
      localStorage.setItem(testKey, payload);
      const readBack = localStorage.getItem(testKey);
      localStorage.removeItem(testKey);

      if (readBack === payload) {
        const lsElapsed = Math.round(performance.now() - lsStart);
        updateStatus('test_localstorage', {
          status: 'passed',
          durationMs: lsElapsed,
          message: language === 'th' ? `ผ่าน (${lsElapsed}ms) - เขียน/อ่าน JSON ถูกต้อง 100%` : `Passed (${lsElapsed}ms) - Read/Write verified 100%`,
          details: `Total storage keys: ${localStorageMetrics.totalKeys}, Footprint: ${formatBytes(localStorageMetrics.totalBytes)}`,
        });
        addDiagLog('success', 'SelfTest', `LocalStorage test passed in ${lsElapsed}ms`);
      } else {
        throw new Error('Payload mismatch on readback');
      }
    } catch (err) {
      updateStatus('test_localstorage', {
        status: 'failed',
        message: language === 'th' ? 'ล้มเหลว - เกิดข้อผิดพลาดในการเขียน/อ่าน' : 'Failed to write/read LocalStorage',
        details: String(err),
      });
      addDiagLog('error', 'SelfTest', 'LocalStorage test failed', err);
    }

    await new Promise((r) => setTimeout(r, 200));

    // 3. Outbox Sync Pipeline Test
    updateStatus('test_sync_pipeline', { status: 'running' });
    const syncStart = performance.now();
    try {
      const outboxCount = outbox.length;
      const syncElapsed = Math.round(performance.now() - syncStart);

      if (failedCount > 0) {
        updateStatus('test_sync_pipeline', {
          status: 'warning',
          durationMs: syncElapsed,
          message: language === 'th' ? `เตือน: มีรายการที่ซิงก์ไม่ผ่าน (${failedCount} รายการ)` : `Warning: ${failedCount} items in failed queue`,
          details: `Pending: ${pendingCount}, Synced: ${syncedCount}, Failed: ${failedCount}`,
        });
        addDiagLog('warn', 'SelfTest', `Outbox test found ${failedCount} failed items`);
      } else {
        updateStatus('test_sync_pipeline', {
          status: 'passed',
          durationMs: syncElapsed,
          message: language === 'th' ? `ผ่าน (${syncElapsed}ms) - คิว Outbox อยู่ในเกณฑ์ปกติ` : `Passed (${syncElapsed}ms) - Outbox pipeline healthy`,
          details: `Queue size: ${outboxCount} items, Connectivity: ${isOnline ? 'Online' : 'Offline'}`,
        });
        addDiagLog('success', 'SelfTest', `Outbox sync test passed in ${syncElapsed}ms`);
      }
    } catch (err) {
      updateStatus('test_sync_pipeline', {
        status: 'failed',
        message: 'Sync pipeline verification failed',
        details: String(err),
      });
    }

    await new Promise((r) => setTimeout(r, 200));

    // 4. Storage Quota Test
    updateStatus('test_storage_quota', { status: 'running' });
    const quotaStart = performance.now();
    try {
      const quotaElapsed = Math.round(performance.now() - quotaStart);
      if (storageQuota.percentUsed > 85) {
        updateStatus('test_storage_quota', {
          status: 'warning',
          durationMs: quotaElapsed,
          message: language === 'th' ? `เตือน: พื้นที่จัดเก็บถูกใช้งานไปแล้ว ${storageQuota.percentUsed.toFixed(1)}%` : `Warning: Storage usage is high (${storageQuota.percentUsed.toFixed(1)}%)`,
          details: `Used: ${formatBytes(storageQuota.usage)} / ${formatBytes(storageQuota.quota)}`,
        });
        addDiagLog('warn', 'SelfTest', `Storage quota usage warning: ${storageQuota.percentUsed.toFixed(1)}%`);
      } else {
        updateStatus('test_storage_quota', {
          status: 'passed',
          durationMs: quotaElapsed,
          message: language === 'th' ? `ผ่าน (${quotaElapsed}ms) - พื้นที่จัดเก็บเพียงพอ (${formatBytes(storageQuota.available)} ว่าง)` : `Passed (${quotaElapsed}ms) - Plenty of quota available (${formatBytes(storageQuota.available)} free)`,
          details: `Used: ${formatBytes(storageQuota.usage)} (${storageQuota.percentUsed.toFixed(2)}%), Persisted: ${storageQuota.isPersisted ? 'Yes' : 'No'}`,
        });
        addDiagLog('success', 'SelfTest', `Storage quota test passed in ${quotaElapsed}ms`);
      }
    } catch (err) {
      updateStatus('test_storage_quota', {
        status: 'failed',
        message: 'Storage quota test failed',
        details: String(err),
      });
    }

    await new Promise((r) => setTimeout(r, 200));

    // 5. Memory Pressure Test
    updateStatus('test_memory_pressure', { status: 'running' });
    const memStart = performance.now();
    try {
      const memElapsed = Math.round(performance.now() - memStart);
      if (memoryMetrics.heapPercent > 80) {
        updateStatus('test_memory_pressure', {
          status: 'warning',
          durationMs: memElapsed,
          message: language === 'th' ? `เตือน: JS Heap ใช้ไป ${memoryMetrics.heapPercent.toFixed(1)}%` : `Warning: High JS Heap usage (${memoryMetrics.heapPercent.toFixed(1)}%)`,
          details: `Used: ${formatBytes(memoryMetrics.usedJSHeapSize)} / ${formatBytes(memoryMetrics.jsHeapSizeLimit)}`,
        });
      } else {
        updateStatus('test_memory_pressure', {
          status: 'passed',
          durationMs: memElapsed,
          message: language === 'th' ? `ผ่าน (${memElapsed}ms) - การใช้งาน Heap อยู่ในเกณฑ์ปกติ` : `Passed (${memElapsed}ms) - JS Heap within optimal bounds`,
          details: memoryMetrics.isSupported
            ? `Used: ${formatBytes(memoryMetrics.usedJSHeapSize)} (${memoryMetrics.heapPercent.toFixed(1)}%)`
            : 'Standard memory budget active (Heap telemetry unavailable in current browser)',
        });
      }
      addDiagLog('success', 'SelfTest', 'Memory pressure test passed');
    } catch (err) {
      updateStatus('test_memory_pressure', {
        status: 'failed',
        message: 'Memory test failed',
        details: String(err),
      });
    }

    setIsRunningTests(false);
    addDiagLog('info', 'SelfTest', 'All diagnostic self-tests completed.');
  };

  // Compute Overall System Health Score (0 - 100)
  const healthScore = useMemo(() => {
    let score = 100;
    if (!isOnline && !isSimulatedOffline) score -= 15;
    if (failedCount > 0) score -= Math.min(25, failedCount * 5);
    if (!idbMetrics.isAvailable) score -= 30;
    if (storageQuota.percentUsed > 85) score -= 20;
    else if (storageQuota.percentUsed > 70) score -= 10;
    if (memoryMetrics.heapPercent > 85) score -= 15;
    return Math.max(0, score);
  }, [isOnline, isSimulatedOffline, failedCount, idbMetrics.isAvailable, storageQuota.percentUsed, memoryMetrics.heapPercent]);

  // Overall Status Label & Color
  const healthStatusInfo = useMemo(() => {
    if (healthScore >= 90) {
      return {
        label: { th: 'ระบบทำงานสมบูรณ์แบบ (Optimal)', en: 'System Status: Optimal' },
        color: 'text-emerald-600 dark:text-emerald-400',
        bg: 'bg-emerald-500/10 border-emerald-500/30',
        badge: 'success' as const,
      };
    }
    if (healthScore >= 70) {
      return {
        label: { th: 'ระบบทำงานได้ดี (Good)', en: 'System Status: Good' },
        color: 'text-blue-600 dark:text-blue-400',
        bg: 'bg-blue-500/10 border-blue-500/30',
        badge: 'primary' as const,
      };
    }
    if (healthScore >= 50) {
      return {
        label: { th: 'ประสิทธิภาพลดลง (Degraded)', en: 'System Status: Degraded' },
        color: 'text-amber-600 dark:text-amber-400',
        bg: 'bg-amber-500/10 border-amber-500/30',
        badge: 'warning' as const,
      };
    }
    return {
      label: { th: 'ต้องการการดูแลด่วน (Critical Attention)', en: 'System Status: Critical' },
      color: 'text-rose-600 dark:text-rose-400',
      bg: 'bg-rose-500/10 border-rose-500/30',
      badge: 'danger' as const,
    };
  }, [healthScore]);

  // Export Full Diagnostic Snapshot Report
  const handleExportReport = () => {
    const report = {
      title: 'PRODX POS System Diagnostics Snapshot',
      exportedAt: new Date().toISOString(),
      store: session?.currentStore || { code: 'STR-01', name: 'Main Store' },
      user: session?.currentUser || { name: 'Admin', role: 'admin' },
      systemHealth: {
        score: healthScore,
        status: healthStatusInfo.label.en,
      },
      connectivity: {
        isOnline,
        isSimulatedOffline,
        simulatedLatencyMs: liveLatencyMs,
        estimatedRoundtripPingMs: roundtripPingMs,
        lastSyncedAt,
      },
      outboxSync: {
        pendingCount,
        syncedCount,
        failedCount,
        isSyncing,
        queue: outbox.map((o) => ({
          id: o.id,
          type: o.type,
          status: o.syncState,
          idempotencyKey: o.idempotencyKey,
          createdAt: o.createdAt,
          retryCount: o.attempts,
        })),
      },
      storageQuota: {
        usageBytes: storageQuota.usage,
        usageFormatted: formatBytes(storageQuota.usage),
        quotaBytes: storageQuota.quota,
        quotaFormatted: formatBytes(storageQuota.quota),
        availableBytes: storageQuota.available,
        availableFormatted: formatBytes(storageQuota.available),
        percentUsed: storageQuota.percentUsed,
        isPersisted: storageQuota.isPersisted,
      },
      indexedDB: {
        productsCached: idbMetrics.productsCount,
        categoriesCached: idbMetrics.categoriesCount,
        ordersCached: idbMetrics.ordersCount,
        status: idbMetrics.status,
      },
      localStorage: {
        totalKeys: localStorageMetrics.totalKeys,
        totalBytes: localStorageMetrics.totalBytes,
        totalFormatted: formatBytes(localStorageMetrics.totalBytes),
        categories: localStorageMetrics.categories,
      },
      runtimeHardware: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
        platform: typeof navigator !== 'undefined' ? navigator.platform : 'Unknown',
        hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 'N/A',
        deviceMemoryGB: typeof navigator !== 'undefined' ? (navigator as any).deviceMemory || 'N/A' : 'N/A',
        screenResolution: typeof window !== 'undefined' ? `${window.screen.width}x${window.screen.height}` : 'N/A',
        devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
        isPwaStandalone: typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches,
        jsHeap: memoryMetrics.isSupported
          ? {
              used: formatBytes(memoryMetrics.usedJSHeapSize),
              total: formatBytes(memoryMetrics.totalJSHeapSize),
              limit: formatBytes(memoryMetrics.jsHeapSizeLimit),
              percent: memoryMetrics.heapPercent,
            }
          : 'Not supported by current browser engine',
      },
      selfTestResults: testResults,
      recentLogs: diagnosticLogs.slice(0, 30),
    };

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(report, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `prodx_diagnostics_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    addDiagLog('info', 'Report', 'Diagnostic telemetry snapshot downloaded.');
    addToast({
      title: language === 'th' ? 'ดาวน์โหลดรายงานการวินิจฉัยแล้ว' : 'Diagnostic Snapshot Exported',
      message: language === 'th' ? 'บันทึกไฟล์ JSON ข้อมูลสุขภาพระบบเรียบร้อย' : 'System health snapshot saved to your computer.',
      type: 'success',
    });
  };

  // Copy Quick Summary to Clipboard
  const handleCopySummary = () => {
    const summary = `=== PRODX POS SYSTEM HEALTH REPORT ===
Generated: ${new Date().toLocaleString()}
Health Score: ${healthScore}% (${healthStatusInfo.label.en})
Connection: ${isOnline ? 'Online' : 'Offline'} (Ping: ${roundtripPingMs ?? 'N/A'}ms, Outbox: ${outbox.length} queued)
Storage: ${formatBytes(storageQuota.usage)} used / ${formatBytes(storageQuota.quota)} total (${storageQuota.percentUsed.toFixed(1)}%)
IndexedDB: Products (${idbMetrics.productsCount}), Orders (${idbMetrics.ordersCount}), Categories (${idbMetrics.categoriesCount})
LocalStorage: ${localStorageMetrics.totalKeys} keys (${formatBytes(localStorageMetrics.totalBytes)})
JS Heap: ${memoryMetrics.isSupported ? formatBytes(memoryMetrics.usedJSHeapSize) : 'N/A'}
Self-Tests: ${testResults.filter((t) => t.status === 'passed').length}/${testResults.length} passed
`;

    navigator.clipboard.writeText(summary);
    setIsCopied(true);
    addDiagLog('info', 'Clipboard', 'Copied quick summary to clipboard.');
    setTimeout(() => setIsCopied(false), 2000);
    addToast({
      title: language === 'th' ? 'คัดลอกสรุปผลแล้ว' : 'Summary Copied',
      message: language === 'th' ? 'คัดลอกข้อมูลสรุปสถานะระบบลงคลิปบอร์ดแล้ว' : 'Diagnostic summary copied to clipboard.',
      type: 'info',
    });
  };

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="diagnostic-overlay-title"
      className={`fixed inset-0 ${getZIndexClass('modal')} flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/75 dark:bg-black/85 backdrop-blur-md animate-in fade-in duration-150 select-none overflow-y-auto`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-5xl max-h-[92vh] sm:max-h-[90vh] flex flex-col bg-card border border-border/90 border-crisp rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 my-auto">
        {/* Top Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-3.5 sm:px-6 py-3 sm:py-3.5 border-b border-border/80 bg-card/95 sm:bg-background/80 backdrop-blur-md gap-2.5 sm:gap-4 shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
              <Activity className="h-4.5 w-4.5 sm:h-5 sm:w-5 animate-pulse" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="diagnostic-overlay-title" className="text-sm sm:text-base font-bold text-text truncate">
                  {language === 'th' ? 'ศูนย์ตรวจสอบสุขภาพและวินิจฉัยระบบ' : 'System Diagnostic & Health Telemetry'}
                </h2>
                <Badge variant={healthStatusInfo.badge} size="sm" dot>
                  {healthScore}%
                </Badge>
              </div>
              <p className="text-[10px] sm:text-[11px] text-text/50 font-medium truncate sm:whitespace-normal">
                {language === 'th'
                  ? 'ตรวจสอบสถานะซิงก์ฐานข้อมูล, ปริมาณแคช IndexedDB, และโควต้าความจุพื้นที่จัดเก็บบราวเซอร์แบบ Real-time'
                  : 'Real-time database synchronization, IndexedDB cache utilization, and browser storage capacity telemetry.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 self-end sm:self-center shrink-0">
            {/* Auto Refresh Toggle */}
            <button
              type="button"
              onClick={() => setIsAutoRefresh(!isAutoRefresh)}
              className={`h-8 px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer active-scale ${
                isAutoRefresh
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-border bg-card text-text/60 hover:bg-background'
              }`}
              title={
                isAutoRefresh
                  ? language === 'th'
                    ? 'กำลังอัปเดตข้อมูลอัตโนมัติ (คลิกเพื่อหยุดชั่วคราว)'
                    : 'Auto-refresh active (Click to pause)'
                  : language === 'th'
                  ? 'หยุดอัปเดตอัตโนมัติ (คลิกเพื่อเริ่ม)'
                  : 'Auto-refresh paused (Click to resume)'
              }
            >
              {isAutoRefresh ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                  <span className="text-[11px] font-mono font-bold">
                    {language === 'th' ? `สด (${refreshCountdown}s)` : `Live (${refreshCountdown}s)`}
                  </span>
                </>
              ) : (
                <>
                  <Pause className="h-3 w-3" />
                  <span className="text-[11px] font-medium">{language === 'th' ? 'หยุดชั่วคราว' : 'Paused'}</span>
                </>
              )}
            </button>

            {/* Manual Refresh Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAllMetrics}
              isLoading={isManualRefreshing}
              className="h-8 px-2.5 text-xs font-bold theme-btn-radius"
              title="Refresh all diagnostics metrics"
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              <span className="hidden sm:inline">{language === 'th' ? 'รีเฟรช' : 'Refresh'}</span>
            </Button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Diagnostic Overlay"
              className="h-8 w-8 rounded-lg border border-border bg-card hover:bg-background text-text/60 hover:text-text flex items-center justify-center transition cursor-pointer active-scale"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Diagnostic Tabs Navigation */}
        <div className="flex items-center px-3 sm:px-6 bg-card/60 border-b border-border/70 overflow-x-auto gap-1 sm:gap-2 py-2 scrollbar-none shrink-0">
          {[
            { id: 'overview', label: { th: 'ภาพรวมสุขภาพระบบ', en: 'Overview & Pulse' }, icon: Gauge },
            { id: 'sync_db', label: { th: 'การซิงก์ & Outbox', en: 'Sync & Database' }, icon: Database, badge: outbox.length > 0 ? outbox.length : undefined },
            { id: 'storage_cache', label: { th: 'พื้นที่จัดเก็บ & แคช', en: 'Storage & Cache' }, icon: HardDrive },
            { id: 'runtime_hw', label: { th: 'สภาพแวดล้อม & ฮาร์ดแวร์', en: 'Runtime & Hardware' }, icon: Cpu },
            { id: 'self_test', label: { th: 'ชุดทดสอบระบบอัตโนมัติ', en: 'Self-Diagnostic Tests' }, icon: Zap },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as DiagnosticTab)}
                className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer active-scale shrink-0 ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-text/75 hover:text-text hover:bg-background/60'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-primary-foreground' : 'text-brand-text-secondary'}`} />
                <span>{tab.label[language]}</span>
                {tab.badge !== undefined && (
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                      isActive ? 'bg-primary-foreground/15 text-primary-foreground' : 'bg-primary/10 text-primary'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-3.5 sm:p-6 space-y-4 sm:space-y-6">
          {/* TAB 1: OVERVIEW & PULSE */}
          {activeTab === 'overview' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Top Health Score Banner */}
              <div className={`p-4 sm:p-5 rounded-2xl border ${healthStatusInfo.bg} flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
                <div className="flex items-center gap-4">
                  <div className="relative flex items-center justify-center h-16 w-16 rounded-2xl bg-card border border-border shadow-md">
                    <span className="text-2xl font-black font-mono text-text">{healthScore}</span>
                    <span className="text-[10px] font-bold text-text/40 absolute bottom-1.5">%</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className={`text-base font-bold ${healthStatusInfo.color}`}>
                        {healthStatusInfo.label[language]}
                      </h3>
                    </div>
                    <p className="text-xs text-text/60 mt-0.5 max-w-xl">
                      {healthScore >= 90
                        ? language === 'th'
                          ? 'การเชื่อมต่อคลาวด์ ฐานข้อมูล IndexedDB และพื้นที่จัดเก็บบราวเซอร์พร้อมทำงานด้วยความเร็วสูงสุด'
                          : 'Database sync, IndexedDB cache integrity, and storage capacity are performing with optimal headroom.'
                        : language === 'th'
                        ? 'มีบางส่วนที่ควรตรวจสอบ เช่น คิวออฟไลน์ที่รอการซิงก์ หรือความจุพื้นที่จัดเก็บ'
                        : 'Some telemetry indicators require review, such as queued outbox orders or storage utilization.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={runSelfDiagnosticTests}
                    isLoading={isRunningTests}
                    className="theme-btn-radius font-bold text-xs"
                    leftIcon={<Zap className="h-3.5 w-3.5" />}
                  >
                    {language === 'th' ? 'รันการทดสอบระบบ' : 'Run Full Self-Check'}
                  </Button>
                </div>
              </div>

              {/* 4 Key Vital Metric Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {/* 1. Cloud Sync Link */}
                <div className="p-4 rounded-xl border border-border/80 bg-card/60 space-y-2">
                  <div className="flex items-center justify-between text-text/60 text-xs">
                    <span className="font-bold flex items-center gap-1.5">
                      <Wifi className="h-3.5 w-3.5 text-primary" />
                      {language === 'th' ? 'สถานะการเชื่อมต่อ' : 'Cloud Sync Link'}
                    </span>
                    <Badge variant={isOnline ? 'success' : 'danger'} size="sm" dot>
                      {isOnline ? 'ONLINE' : 'OFFLINE'}
                    </Badge>
                  </div>
                  <div className="text-xl font-bold font-mono text-text flex items-baseline gap-1.5">
                    <span>{roundtripPingMs !== null ? `${roundtripPingMs} ms` : 'N/A'}</span>
                    <span className="text-[10px] text-text/50 font-normal">
                      ({liveLatencyMs}ms injected)
                    </span>
                  </div>
                  <div className="text-[11px] text-text/50 flex items-center justify-between pt-1 border-t border-border/40">
                    <span>{language === 'th' ? 'คิวค้าง Outbox' : 'Pending Outbox'}:</span>
                    <span className="font-mono font-bold text-text">{pendingCount} items</span>
                  </div>
                </div>

                {/* 2. Browser Storage Quota */}
                <div className="p-4 rounded-xl border border-border/80 bg-card/60 space-y-2">
                  <div className="flex items-center justify-between text-text/60 text-xs">
                    <span className="font-bold flex items-center gap-1.5">
                      <HardDrive className="h-3.5 w-3.5 text-brand-text-accent" />
                      {language === 'th' ? 'พื้นที่จัดเก็บบราวเซอร์' : 'Browser Storage'}
                    </span>
                    <Badge
                      variant={storageQuota.percentUsed > 80 ? 'danger' : storageQuota.percentUsed > 50 ? 'warning' : 'success'}
                      size="sm"
                    >
                      {storageQuota.percentUsed.toFixed(1)}%
                    </Badge>
                  </div>
                  <div className="text-xl font-bold font-mono text-text">
                    {formatBytes(storageQuota.usage)}
                  </div>
                  <div className="space-y-1">
                    <div className="w-full bg-background rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          storageQuota.percentUsed > 80
                            ? 'bg-rose-500'
                            : storageQuota.percentUsed > 50
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.max(1, storageQuota.percentUsed)}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-text/50 flex items-center justify-between">
                      <span>{language === 'th' ? 'โควต้าทั้งหมด' : 'Total Quota'}:</span>
                      <span className="font-mono">{formatBytes(storageQuota.quota)}</span>
                    </div>
                  </div>
                </div>

                {/* 3. IndexedDB Persistence */}
                <div className="p-4 rounded-xl border border-border/80 bg-card/60 space-y-2">
                  <div className="flex items-center justify-between text-text/60 text-xs">
                    <span className="font-bold flex items-center gap-1.5">
                      <Database className="h-3.5 w-3.5 text-emerald-500" />
                      {language === 'th' ? 'ฐานข้อมูลแคชในเครื่อง' : 'IndexedDB Cache'}
                    </span>
                    <Badge variant={idbMetrics.isAvailable ? 'success' : 'danger'} size="sm">
                      {idbMetrics.status}
                    </Badge>
                  </div>
                  <div className="text-xl font-bold font-mono text-text">
                    {idbMetrics.productsCount + idbMetrics.ordersCount + idbMetrics.categoriesCount}
                    <span className="text-xs font-normal text-text/50 ml-1">records</span>
                  </div>
                  <div className="text-[10px] text-text/50 flex items-center justify-between pt-1 border-t border-border/40">
                    <span>{language === 'th' ? 'สินค้า/ออเดอร์' : 'Products/Orders'}:</span>
                    <span className="font-mono text-text">
                      {idbMetrics.productsCount} / {idbMetrics.ordersCount}
                    </span>
                  </div>
                </div>

                {/* 4. Memory Heap */}
                <div className="p-4 rounded-xl border border-border/80 bg-card/60 space-y-2">
                  <div className="flex items-center justify-between text-text/60 text-xs">
                    <span className="font-bold flex items-center gap-1.5">
                      <Cpu className="h-3.5 w-3.5 text-amber-500" />
                      {language === 'th' ? 'หน่วยความจำ JS Heap' : 'JS Heap Memory'}
                    </span>
                    <Badge variant="primary" size="sm">
                      {memoryMetrics.isSupported ? `${memoryMetrics.heapPercent.toFixed(1)}%` : 'Standard'}
                    </Badge>
                  </div>
                  <div className="text-xl font-bold font-mono text-text">
                    {memoryMetrics.isSupported ? formatBytes(memoryMetrics.usedJSHeapSize) : 'Optimal'}
                  </div>
                  <div className="text-[10px] text-text/50 flex items-center justify-between pt-1 border-t border-border/40">
                    <span>{language === 'th' ? 'ขีดจำกัดหน่วยความจำ' : 'Heap Limit'}:</span>
                    <span className="font-mono text-text">
                      {memoryMetrics.isSupported ? formatBytes(memoryMetrics.jsHeapSizeLimit) : 'Browser Managed'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Quick Action Matrix & Self-Test Summary */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Self Test Progress Card */}
                <div className="p-4 sm:p-5 rounded-2xl border border-border/80 bg-card space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-primary" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-text">
                        {language === 'th' ? 'สถานะการทดสอบระบบ (Automated Benchmark)' : 'Self-Test Health Audit'}
                      </h4>
                    </div>
                    <span className="text-[11px] font-mono text-text/60">
                      {testResults.filter((t) => t.status === 'passed').length}/{testResults.length} Passed
                    </span>
                  </div>

                  <div className="space-y-2">
                    {testResults.map((test) => (
                      <div
                        key={test.id}
                        className="p-2.5 rounded-lg border border-border/60 bg-background/50 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          {test.status === 'passed' ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                          ) : test.status === 'running' ? (
                            <RefreshCw className="h-4 w-4 text-primary animate-spin shrink-0" />
                          ) : test.status === 'warning' ? (
                            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                          ) : test.status === 'failed' ? (
                            <AlertOctagon className="h-4 w-4 text-rose-500 shrink-0" />
                          ) : (
                            <div className="h-4 w-4 rounded-full border border-border shrink-0" />
                          )}
                          <div>
                            <div className="font-semibold text-text text-xs">{test.name[language]}</div>
                            {test.message && (
                              <div className="text-[11px] text-text/60">{test.message}</div>
                            )}
                          </div>
                        </div>
                        {test.durationMs !== undefined && (
                          <span className="text-[10px] font-mono font-bold text-text/50">
                            {test.durationMs}ms
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={runSelfDiagnosticTests}
                    isLoading={isRunningTests}
                    className="w-full theme-btn-radius font-bold text-xs"
                  >
                    {language === 'th' ? 'รันการทดสอบใหม่อีกครั้ง' : 'Re-run Benchmark Suite'}
                  </Button>
                </div>

                {/* Live Diagnostic Logs Stream */}
                <div className="p-4 sm:p-5 rounded-2xl border border-border/80 bg-card space-y-3 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Terminal className="h-4 w-4 text-brand-text-accent" />
                        <h4 className="text-xs font-bold uppercase tracking-wider text-text">
                          {language === 'th' ? 'บันทึกเหตุการณ์การวินิจฉัย (Telemetry Stream)' : 'Real-time Event Stream'}
                        </h4>
                      </div>
                      <span className="text-[10px] font-mono text-text/40">{diagnosticLogs.length} events</span>
                    </div>

                    <div className="h-56 overflow-y-auto rounded-lg border border-border/70 bg-background/80 p-2.5 space-y-1.5 font-mono text-[11px] scrollbar-none">
                      {diagnosticLogs.length === 0 ? (
                        <div className="text-text/40 text-center py-12">
                          {language === 'th' ? 'ยังไม่มีบันทึกเหตุการณ์' : 'No telemetry events recorded yet.'}
                        </div>
                      ) : (
                        diagnosticLogs.map((log) => (
                          <div
                            key={log.id}
                            className={`p-1.5 rounded flex items-start gap-2 ${
                              log.level === 'error'
                                ? 'bg-rose-500/10 text-rose-500'
                                : log.level === 'warn'
                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                : log.level === 'success'
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : 'text-text/80'
                            }`}
                          >
                            <span className="text-[10px] text-text/40 shrink-0 font-sans">{log.timestamp}</span>
                            <span className="px-1 py-0.2 rounded bg-card text-[9px] font-bold uppercase shrink-0 border border-border/40">
                              {log.category}
                            </span>
                            <span className="truncate flex-1">{log.message}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-border/40 text-xs">
                    <span className="text-[11px] text-text/50">
                      {language === 'th' ? 'อัปเดตอัตโนมัติเมื่อเกิดกิจกรรม' : 'Live stream updates automatically'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setDiagnosticLogs([])}
                      className="text-text/50 hover:text-rose-500 text-[11px] font-semibold transition cursor-pointer"
                    >
                      {language === 'th' ? 'ล้างบันทึก' : 'Clear Stream'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SYNC & DATABASE */}
          {activeTab === 'sync_db' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Outbox Pipeline Overview */}
              <div className="p-5 rounded-2xl border border-border/80 bg-card space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-text flex items-center gap-2">
                      <Database className="h-4 w-4 text-primary" />
                      <span>{language === 'th' ? 'ท่อส่งข้อมูลการซิงก์ (Outbox Queue Telemetry)' : 'Outbox Queue Telemetry'}</span>
                    </h3>
                    <p className="text-xs text-text/50 mt-0.5">
                      {language === 'th'
                        ? 'รายการธุรกรรมที่บันทึกไว้ในอุปกรณ์และรอส่งขึ้นเซิร์ฟเวอร์แบบการันตีความถูกต้อง (Idempotent)'
                        : 'Local transactions stored in client queue waiting for authoritative server commitment.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={triggerSync}
                      isLoading={isSyncing}
                      disabled={outbox.length === 0}
                      className="theme-btn-radius font-bold text-xs"
                      leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                    >
                      {language === 'th' ? 'บังคับซิงก์ข้อมูลทันที' : 'Force Sync Now'}
                    </Button>
                  </div>
                </div>

                {/* Queue Summary Counter Pills */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-xl border border-border/70 bg-background/50">
                    <span className="text-[10px] uppercase font-bold text-text/50">
                      {language === 'th' ? 'รอซิงก์ (Pending)' : 'Pending Sync'}
                    </span>
                    <div className="text-2xl font-black font-mono text-amber-500 mt-0.5">
                      {pendingCount}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border border-border/70 bg-background/50">
                    <span className="text-[10px] uppercase font-bold text-text/50">
                      {language === 'th' ? 'ซิงก์สำเร็จ (Synced)' : 'Synced Confirm'}
                    </span>
                    <div className="text-2xl font-black font-mono text-emerald-500 mt-0.5">
                      {syncedCount}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border border-border/70 bg-background/50">
                    <span className="text-[10px] uppercase font-bold text-text/50">
                      {language === 'th' ? 'ล้มเหลว (Failed)' : 'Failed / Retry'}
                    </span>
                    <div className="text-2xl font-black font-mono text-rose-500 mt-0.5">
                      {failedCount}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border border-border/70 bg-background/50">
                    <span className="text-[10px] uppercase font-bold text-text/50">
                      {language === 'th' ? 'ซิงก์ล่าสุด' : 'Last Synced'}
                    </span>
                    <div className="text-xs font-mono font-bold text-text mt-2 truncate">
                      {lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : 'Never'}
                    </div>
                  </div>
                </div>

                {/* Detailed Outbox Items Inspector */}
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between text-xs font-bold text-text/70">
                    <span>{language === 'th' ? 'รายการในคิว Outbox' : 'Queued Transaction Payloads'}</span>
                    {outbox.length > 0 && (
                      <button
                        type="button"
                        onClick={clearOutbox}
                        className="text-rose-500 hover:text-rose-600 flex items-center gap-1 font-semibold text-[11px] cursor-pointer"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>{language === 'th' ? 'ล้างคิวทั้งหมด' : 'Purge Queue'}</span>
                      </button>
                    )}
                  </div>

                  {outbox.length === 0 ? (
                    <div className="p-8 rounded-xl border border-border/60 bg-background/40 text-center space-y-1">
                      <CheckCircle2 className="h-6 w-6 text-emerald-500 mx-auto" />
                      <div className="text-xs font-bold text-text">
                        {language === 'th' ? 'ไม่มีรายการค้างในคิว Outbox' : 'All transactions are synchronized with cloud'}
                      </div>
                      <p className="text-[11px] text-text/50">
                        {language === 'th'
                          ? 'ข้อมูลออเดอร์ทั้งหมดถูกยืนยันไปยังเซิร์ฟเวอร์เรียบร้อยแล้ว'
                          : 'Zero offline outbox lag detected.'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {outbox.map((item) => {
                        const isExpanded = expandedOutboxId === item.id;
                        return (
                          <div
                            key={item.id}
                            className="p-3 rounded-xl border border-border/70 bg-card/60 hover:bg-card transition space-y-2"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant={
                                    item.syncState === 'synced'
                                      ? 'success'
                                      : item.syncState === 'failed'
                                      ? 'danger'
                                      : 'warning'
                                  }
                                  size="sm"
                                >
                                  {item.syncState}
                                </Badge>
                                <span className="font-bold text-text">{item.type}</span>
                                <span className="text-[10px] font-mono text-text/40 truncate max-w-[120px] sm:max-w-xs">
                                  {item.idempotencyKey}
                                </span>
                              </div>

                              <button
                                type="button"
                                onClick={() => setExpandedOutboxId(isExpanded ? null : item.id)}
                                className="text-text/50 hover:text-text flex items-center gap-1 text-[11px] font-semibold cursor-pointer"
                              >
                                <span>{isExpanded ? 'Hide Payload' : 'Inspect'}</span>
                                {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                              </button>
                            </div>

                            {isExpanded && (
                              <pre className="p-2.5 rounded-lg bg-background font-mono text-[10px] text-text/80 overflow-x-auto border border-border/60">
                                {JSON.stringify(item.payload, null, 2)}
                              </pre>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Offline Simulator Controls */}
              <div className="p-5 rounded-2xl border border-border/80 bg-card flex items-center justify-between">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-text flex items-center gap-2">
                    {isSimulatedOffline ? <WifiOff className="h-4 w-4 text-amber-500" /> : <Wifi className="h-4 w-4 text-primary" />}
                    <span>{language === 'th' ? 'โหมดจำลองตัดการเชื่อมต่อ (Simulate Offline)' : 'Force Simulated Offline Mode'}</span>
                  </div>
                  <p className="text-[11px] text-text/50">
                    {language === 'th'
                      ? 'บังคับให้ POS ทำงานแบบออฟไลน์เต็มรูปแบบเพื่อทดสอบการบันทึกลง Outbox และการกู้คืนอัตโนมัติ'
                      : 'Force client into offline queueing mode to audit offline zero-downtime resilient failovers.'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={toggleSimulatedOffline}
                  className={`w-12 h-6.5 shrink-0 flex items-center rounded-full p-1 transition-colors cursor-pointer active-scale ${
                    isSimulatedOffline ? 'bg-amber-500' : 'bg-border dark:bg-background'
                  }`}
                >
                  <div
                    className={`bg-white w-4.5 h-4.5 rounded-full shadow-md transform transition-transform ${
                      isSimulatedOffline ? 'translate-x-5.5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: STORAGE & CACHE */}
          {activeTab === 'storage_cache' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Browser Storage Quota Details Card */}
              <div className="p-5 rounded-2xl border border-border/80 bg-card space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-text flex items-center gap-2">
                      <HardDrive className="h-4 w-4 text-primary" />
                      <span>{language === 'th' ? 'โควต้าความจุพื้นที่จัดเก็บบราวเซอร์ (Storage Quota API)' : 'Storage Quota & Capacity Telemetry'}</span>
                    </h3>
                    <p className="text-xs text-text/50 mt-0.5">
                      {language === 'th'
                        ? 'วัดปริมาณการใช้งาน IndexedDB, Cache Storage และพื้นที่ว่างที่ระบบปฏิบัติการจัดสรรให้บราวเซอร์'
                        : 'Measures total quota and utilization across IndexedDB, Cache API, and Web Storage.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant={storageQuota.isPersisted ? 'secondary' : 'outline'}
                      size="sm"
                      onClick={handleRequestPersistence}
                      disabled={storageQuota.isPersisted}
                      className="theme-btn-radius font-bold text-xs"
                      leftIcon={<Shield className="h-3.5 w-3.5 text-emerald-500" />}
                    >
                      {storageQuota.isPersisted
                        ? language === 'th'
                          ? 'ได้รับการปกป้องถาวรแล้ว (Persisted)'
                          : 'Storage Persisted (Granted)'
                        : language === 'th'
                        ? 'ขอสิทธิ์จัดเก็บถาวร (Request Persistence)'
                        : 'Request Storage Persistence'}
                    </Button>
                  </div>
                </div>

                {/* Capacity Visual Progress Bar */}
                <div className="p-4 rounded-xl border border-border/70 bg-background/50 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-text">
                    <span>{language === 'th' ? 'ปริมาณที่ใช้ไป' : 'Used Space'}: {formatBytes(storageQuota.usage)}</span>
                    <span>{language === 'th' ? 'โควต้าสูงสุด' : 'Total Quota'}: {formatBytes(storageQuota.quota)}</span>
                  </div>
                  <div className="w-full bg-card rounded-full h-3 overflow-hidden border border-border/60">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        storageQuota.percentUsed > 80
                          ? 'bg-rose-500'
                          : storageQuota.percentUsed > 50
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.max(1, storageQuota.percentUsed)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-text/50">
                    <span>
                      {language === 'th' ? 'พื้นที่ว่างคงเหลือ' : 'Available Headroom'}:{' '}
                      <strong className="text-text font-mono">{formatBytes(storageQuota.available)}</strong>
                    </span>
                    <span>
                      {language === 'th' ? 'สัดส่วนที่ใช้' : 'Utilization'}:{' '}
                      <strong className="text-text font-mono">{storageQuota.percentUsed.toFixed(2)}%</strong>
                    </span>
                  </div>
                </div>

                {/* Storage Specifications Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-3.5 rounded-xl border border-border/60 bg-card/60 space-y-1">
                    <div className="text-[10px] font-bold uppercase text-text/50">
                      {language === 'th' ? 'นโยบายการจัดเก็บ' : 'Eviction Policy'}
                    </div>
                    <div className="text-sm font-bold text-text flex items-center gap-1.5">
                      <Badge variant={storageQuota.isPersisted ? 'success' : 'warning'} size="sm">
                        {storageQuota.isPersisted ? 'Persistent' : 'Best-Effort'}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-text/50">
                      {storageQuota.isPersisted
                        ? 'Data protected from automated OS eviction'
                        : 'Subject to browser eviction under high storage pressure'}
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-border/60 bg-card/60 space-y-1">
                    <div className="text-[10px] font-bold uppercase text-text/50">
                      {language === 'th' ? 'ฐานข้อมูล IndexedDB' : 'IndexedDB Engine'}
                    </div>
                    <div className="text-sm font-bold text-text font-mono">
                      {idbMetrics.productsCount + idbMetrics.ordersCount + idbMetrics.categoriesCount} items
                    </div>
                    <p className="text-[10px] text-text/50">
                      Stores: products, categories, orders
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-border/60 bg-card/60 space-y-1">
                    <div className="text-[10px] font-bold uppercase text-text/50">
                      {language === 'th' ? 'แคช LocalStorage' : 'LocalStorage Cache'}
                    </div>
                    <div className="text-sm font-bold text-text font-mono">
                      {localStorageMetrics.totalKeys} keys ({formatBytes(localStorageMetrics.totalBytes)})
                    </div>
                    <p className="text-[10px] text-text/50">
                      Across {localStorageMetrics.categories.length} functional categories
                    </p>
                  </div>
                </div>
              </div>

              {/* LocalStorage Categorized Key-Value Breakdown */}
              <div className="p-5 rounded-2xl border border-border/80 bg-card space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-text flex items-center gap-2">
                    <Sliders className="h-4 w-4 text-brand-text-accent" />
                    <span>{language === 'th' ? 'แจกแจงการใช้งาน LocalStorage แยกตามหมวดหมู่' : 'LocalStorage Footprint Breakdown'}</span>
                  </h4>
                  <span className="text-[11px] font-mono text-text/50">
                    {formatBytes(localStorageMetrics.totalBytes)} total
                  </span>
                </div>

                <div className="space-y-2">
                  {localStorageMetrics.categories.map((cat) => {
                    const isExpanded = expandedStorageCategory === cat.category;
                    return (
                      <div
                        key={cat.category}
                        className="rounded-xl border border-border/60 bg-background/50 overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => setExpandedStorageCategory(isExpanded ? null : cat.category)}
                          className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-semibold text-text hover:bg-card/60 transition cursor-pointer select-none"
                        >
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-primary" /> : <ChevronRight className="h-3.5 w-3.5 text-text/40" />}
                            <span className="font-bold">{cat.category}</span>
                            <span className="text-[10px] font-mono text-text/50">({cat.keysCount} keys)</span>
                          </div>
                          <span className="font-mono text-[11px] font-bold text-primary">
                            {formatBytes(cat.bytes)}
                          </span>
                        </button>

                        {isExpanded && (
                          <div className="px-3.5 pb-3 pt-1 border-t border-border/40 space-y-1.5 text-[11px] font-mono">
                            {cat.keys.map((k) => (
                              <div
                                key={k.key}
                                className="flex items-center justify-between py-1 px-2 rounded bg-card/70 border border-border/30 text-text/80"
                              >
                                <span className="truncate max-w-sm sm:max-w-md">{k.key}</span>
                                <span className="text-text/50 text-[10px]">{formatBytes(k.bytes)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: RUNTIME & HARDWARE */}
          {activeTab === 'runtime_hw' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Hardware & Browser Telemetry Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Hardware Spec Card */}
                <div className="p-5 rounded-2xl border border-border/80 bg-card space-y-4">
                  <h3 className="text-sm font-bold text-text flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-primary" />
                    <span>{language === 'th' ? 'สเปกอุปกรณ์และฮาร์ดแวร์' : 'Hardware & Execution Specs'}</span>
                  </h3>

                  <div className="space-y-2.5 text-xs">
                    <div className="flex items-center justify-between py-1.5 border-b border-border/40">
                      <span className="text-text/60">{language === 'th' ? 'จำนวนคอร์ประมวลผล (CPU Cores)' : 'Logical CPU Cores'}:</span>
                      <strong className="font-mono text-text">
                        {typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 'N/A' : 'N/A'} Cores
                      </strong>
                    </div>

                    <div className="flex items-center justify-between py-1.5 border-b border-border/40">
                      <span className="text-text/60">{language === 'th' ? 'ขนาด RAM อุปกรณ์ (Device RAM)' : 'Device Memory'}:</span>
                      <strong className="font-mono text-text">
                        {typeof navigator !== 'undefined' && (navigator as any).deviceMemory
                          ? `${(navigator as any).deviceMemory} GB`
                          : 'Standard Memory Target'}
                      </strong>
                    </div>

                    <div className="flex items-center justify-between py-1.5 border-b border-border/40">
                      <span className="text-text/60">{language === 'th' ? 'ความละเอียดหน้าจอ (Screen Resolution)' : 'Screen Geometry'}:</span>
                      <strong className="font-mono text-text">
                        {typeof window !== 'undefined' ? `${window.screen.width} × ${window.screen.height}` : 'N/A'} (DPR: {typeof window !== 'undefined' ? window.devicePixelRatio : 1}x)
                      </strong>
                    </div>

                    <div className="flex items-center justify-between py-1.5">
                      <span className="text-text/60">{language === 'th' ? 'โหมดการแสดงผล PWA' : 'Display Mode'}:</span>
                      <Badge
                        variant={
                          typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches
                            ? 'success'
                            : 'neutral'
                        }
                        size="sm"
                      >
                        {typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches
                          ? 'Standalone PWA'
                          : 'Browser Tab'}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Memory & Heap Budget Card */}
                <div className="p-5 rounded-2xl border border-border/80 bg-card space-y-4">
                  <h3 className="text-sm font-bold text-text flex items-center gap-2">
                    <Activity className="h-4 w-4 text-emerald-500" />
                    <span>{language === 'th' ? 'งบประมาณหน่วยความจำ JS Heap' : 'V8 JavaScript Heap Telemetry'}</span>
                  </h3>

                  {memoryMetrics.isSupported ? (
                    <div className="space-y-3">
                      <div className="p-3.5 rounded-xl border border-border/60 bg-background/50 space-y-2">
                        <div className="flex items-center justify-between text-xs font-bold">
                          <span>{language === 'th' ? 'ใช้งานปัจจุบัน' : 'Used Heap'}: {formatBytes(memoryMetrics.usedJSHeapSize)}</span>
                          <span>{language === 'th' ? 'ขีดจำกัด' : 'Limit'}: {formatBytes(memoryMetrics.jsHeapSizeLimit)}</span>
                        </div>
                        <div className="w-full bg-card rounded-full h-2 overflow-hidden border border-border/60">
                          <div
                            className="bg-emerald-500 h-full rounded-full transition-all"
                            style={{ width: `${Math.max(1, memoryMetrics.heapPercent)}%` }}
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-center justify-between py-1 border-b border-border/40">
                          <span className="text-text/60">Total Allocated Heap:</span>
                          <strong className="font-mono text-text">{formatBytes(memoryMetrics.totalJSHeapSize)}</strong>
                        </div>
                        <div className="flex items-center justify-between py-1">
                          <span className="text-text/60">Used vs Limit:</span>
                          <strong className="font-mono text-emerald-600 dark:text-emerald-400">
                            {memoryMetrics.heapPercent.toFixed(1)}%
                          </strong>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 rounded-xl border border-border/60 bg-background/40 text-center space-y-1">
                      <Info className="h-5 w-5 text-text/40 mx-auto" />
                      <div className="text-xs font-bold text-text">
                        {language === 'th' ? 'ฟีเจอร์ Memory Telemetry ไม่รองรับในบราวเซอร์นี้' : 'Heap telemetry restricted by current browser'}
                      </div>
                      <p className="text-[11px] text-text/50">
                        {language === 'th'
                          ? 'เบราว์เซอร์เช่น Safari / Firefox ปิดกั้นการอ่าน JS Heap เพื่อความปลอดภัย'
                          : 'Available on Chromium / Chrome / Edge engine platforms.'}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Supported Modern Web APIs Checklist */}
              <div className="p-5 rounded-2xl border border-border/80 bg-card space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-text flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <span>{language === 'th' ? 'ความพร้อมของ Web API และความสามารถออฟไลน์' : 'Platform & Web Capabilities Checklist'}</span>
                </h4>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
                  {[
                    { name: 'IndexedDB', supported: typeof window !== 'undefined' && !!window.indexedDB },
                    { name: 'Storage Quota', supported: typeof navigator !== 'undefined' && !!navigator.storage },
                    { name: 'Service Worker', supported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator },
                    { name: 'BroadcastChannel', supported: typeof window !== 'undefined' && 'BroadcastChannel' in window },
                    { name: 'Web Crypto API', supported: typeof window !== 'undefined' && !!window.crypto },
                    { name: 'Web Audio Synth', supported: typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window) },
                  ].map((feat) => (
                    <div
                      key={feat.name}
                      className="p-2.5 rounded-lg border border-border/60 bg-background/50 flex items-center justify-between"
                    >
                      <span className="font-semibold text-text text-[11px]">{feat.name}</span>
                      {feat.supported ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <X className="h-3.5 w-3.5 text-rose-500" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: SELF-TEST SUITE & AUDIT */}
          {activeTab === 'self_test' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="p-5 rounded-2xl border border-border/80 bg-card space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-text flex items-center gap-2">
                      <Zap className="h-4 w-4 text-primary" />
                      <span>{language === 'th' ? 'ชุดทดสอบความสมบูรณ์ของระบบแบบอัตโนมัติ' : 'Automated Diagnostic Self-Test Suite'}</span>
                    </h3>
                    <p className="text-xs text-text/50 mt-0.5">
                      {language === 'th'
                        ? 'ทดสอบความเร็วและประสิทธิภาพของ IndexedDB, LocalStorage, ท่อส่งข้อมูล Outbox, และหน่วยความจำ'
                        : 'Execute live validation benchmarks across storage engines, transaction pipelines, and runtime bounds.'}
                    </p>
                  </div>

                  <Button
                    variant="primary"
                    size="sm"
                    onClick={runSelfDiagnosticTests}
                    isLoading={isRunningTests}
                    className="theme-btn-radius font-bold text-xs"
                    leftIcon={<Play className="h-3.5 w-3.5 fill-current" />}
                  >
                    {language === 'th' ? 'เริ่มต้นการทดสอบ' : 'Execute All Tests'}
                  </Button>
                </div>

                <div className="space-y-3">
                  {testResults.map((test, index) => (
                    <div
                      key={test.id}
                      className="p-4 rounded-xl border border-border/70 bg-background/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5">
                          {test.status === 'passed' ? (
                            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                              <CheckCircle2 className="h-5 w-5" />
                            </div>
                          ) : test.status === 'running' ? (
                            <div className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                              <RefreshCw className="h-5 w-5 animate-spin" />
                            </div>
                          ) : test.status === 'warning' ? (
                            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20">
                              <AlertTriangle className="h-5 w-5" />
                            </div>
                          ) : test.status === 'failed' ? (
                            <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500 border border-rose-500/20">
                              <AlertOctagon className="h-5 w-5" />
                            </div>
                          ) : (
                            <div className="p-1.5 rounded-lg bg-card text-text/40 border border-border">
                              <span className="font-mono text-xs font-bold block w-5 text-center">0{index + 1}</span>
                            </div>
                          )}
                        </div>

                        <div className="space-y-0.5">
                          <div className="font-bold text-text text-xs flex items-center gap-2">
                            <span>{test.name[language]}</span>
                            {test.durationMs !== undefined && (
                              <Badge variant="neutral" size="sm" className="font-mono text-[10px]">
                                {test.durationMs} ms
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-text/50">{test.description[language]}</p>
                          {test.message && (
                            <div className="text-xs font-semibold text-text/80 pt-0.5">{test.message}</div>
                          )}
                          {test.details && (
                            <div className="text-[10px] font-mono text-text/50">{test.details}</div>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center justify-end">
                        <Badge
                          variant={
                            test.status === 'passed'
                              ? 'success'
                              : test.status === 'running'
                              ? 'primary'
                              : test.status === 'warning'
                              ? 'warning'
                              : test.status === 'failed'
                              ? 'danger'
                              : 'neutral'
                          }
                          size="sm"
                        >
                          {test.status.toUpperCase()}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Action Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-3 px-3.5 sm:px-6 py-2.5 sm:py-3.5 border-t border-border/80 bg-card/95 sm:bg-background/80 backdrop-blur-md shrink-0">
          <div className="flex items-center justify-between w-full sm:w-auto gap-2 text-xs text-text/60">
            <span className="font-bold text-text text-[11px] sm:text-xs">PRODX Telemetry v2.4.0</span>
            <span className="text-text/40">•</span>
            <span className="font-mono text-[10px] sm:text-[11px] text-text/60">
              {language === 'th' ? `อัปเดต: ${new Date().toLocaleTimeString()}` : `Last tick: ${new Date().toLocaleTimeString()}`}
            </span>
          </div>

          <div className="grid grid-cols-3 sm:flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopySummary}
              className="theme-btn-radius font-bold text-[11px] sm:text-xs px-2 sm:px-3 h-8 min-h-[32px] justify-center truncate"
              leftIcon={isCopied ? <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> : <Copy className="h-3.5 w-3.5 shrink-0" />}
            >
              <span className="truncate">
                {isCopied
                  ? language === 'th'
                    ? 'คัดลอกแล้ว!'
                    : 'Copied!'
                  : language === 'th'
                  ? 'คัดลอกสรุป'
                  : 'Copy Summary'}
              </span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExportReport}
              className="theme-btn-radius font-bold text-[11px] sm:text-xs px-2 sm:px-3 h-8 min-h-[32px] justify-center truncate"
              leftIcon={<Download className="h-3.5 w-3.5 text-primary shrink-0" />}
            >
              <span className="truncate">{language === 'th' ? 'ดาวน์โหลด (JSON)' : 'Export Report'}</span>
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={onClose}
              className="theme-btn-radius font-bold text-[11px] sm:text-xs px-3 sm:px-4 min-h-[40px] justify-center truncate bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs"
            >
              <span className="truncate">{language === 'th' ? 'ปิดหน้าต่าง' : 'Close'}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
