[Reading 380 lines from start (total: 380 lines, 0 remaining)]

/**
 * PRODX POS - Offline Resilience & Outbox Synchronization Context
 * 
 * Invariant: Never pretend an offline transaction is server-committed.
 * Transactions created during connectivity drop are queued locally with
 * 'pending_sync_offline' status until authoritative server confirmation is received.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { OutboxItem } from '../domain/sync';
import { createSyncApi } from '../adapters/syncApiFactory';
import { Order } from '../domain/order';
import { useToast } from './ToastContext';
import { useLanguage } from './LanguageContext';
import { useAuth } from './AuthContext';

export type SyncLatencyQuality = 'optimal' | 'good' | 'moderate' | 'high' | 'poor' | 'offline';

export interface SyncLatencyRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly latencyMs: number;
  readonly source: 'outbox_sync' | 'cloud_heartbeat' | 'cloud_ping' | 'order_commit';
  readonly status: 'success' | 'failed';
}

interface OfflineContextType {
  isOnline: boolean;
  isSimulatedOffline: boolean;
  outbox: OutboxItem[];
  pendingCount: number;
  syncedCount: number;
  failedCount: number;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  syncLatencyMs: number | null;
  syncLatencyQuality: SyncLatencyQuality;
  syncLatencyHistory: readonly SyncLatencyRecord[];
  avgSyncLatencyMs: number;
  minSyncLatencyMs: number;
  maxSyncLatencyMs: number;
  lastSyncCycleAt: string | null;
  isMeasuringLatency: boolean;
  measureSyncLatency: () => Promise<number | null>;
  toggleSimulatedOffline: () => void;
  queueOutboxItem: <T>(type: 'order_transaction' | 'shift_movement' | 'stock_adjustment', idempotencyKey: string, payload: T) => OutboxItem<T>;
  triggerSync: () => Promise<void>;
  clearSyncedItems: () => void;
  clearOutbox: () => void;
}

const OfflineContext = createContext<OfflineContextType | undefined>(undefined);

const OUTBOX_STORAGE_KEY = 'prodx_pos_outbox';
const LAST_SYNCED_STORAGE_KEY = 'prodx_pos_last_synced';
const MAX_LATENCY_HISTORY_LENGTH = 20;

export function computeLatencyQuality(ms: number | null, isOnline: boolean): SyncLatencyQuality {
  if (!isOnline || ms === null) return 'offline';
  if (ms < 100) return 'optimal';
  if (ms < 250) return 'good';
  if (ms < 500) return 'moderate';
  if (ms < 1000) return 'high';
  return 'poor';
}

export const OfflineProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { addToast } = useToast();
  const { session } = useAuth();
  const syncApi = createSyncApi(session?.token ?? '');
  const { language } = useLanguage();
  const [browserOnline, setBrowserOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isSimulatedOffline, setIsSimulatedOffline] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_SYNCED_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [outbox, setOutbox] = useState<OutboxItem[]>(() => {
    try {
      const raw = localStorage.getItem(OUTBOX_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Real-time Sync Latency state
  const [syncLatencyMs, setSyncLatencyMs] = useState<number | null>(null);
  const [isMeasuringLatency, setIsMeasuringLatency] = useState<boolean>(false);
  const [lastSyncCycleAt, setLastSyncCycleAt] = useState<string | null>(() => new Date().toISOString());
  const [syncLatencyHistory, setSyncLatencyHistory] = useState<SyncLatencyRecord[]>([]);

  const isEffectiveOnline = browserOnline && !isSimulatedOffline;

  const recordLatency = useCallback(
    (ms: number, source: SyncLatencyRecord['source'], status: 'success' | 'failed' = 'success') => {
      const now = new Date().toISOString();
      const record: SyncLatencyRecord = {
        id: `lat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: now,
        latencyMs: ms,
        source,
        status,
      };
      if (status === 'success') {
        setSyncLatencyMs(ms);
      } else {
        setSyncLatencyMs(null);
      }
      setLastSyncCycleAt(now);
      setSyncLatencyHistory((prev) => [record, ...prev.slice(0, MAX_LATENCY_HISTORY_LENGTH - 1)]);
    },
    []
  );

  const measureSyncLatency = useCallback(async (): Promise<number | null> => {
    if (!isEffectiveOnline) {
      setSyncLatencyMs(null);
      return null;
    }
    setIsMeasuringLatency(true);
    const startTime = performance.now();
    try {
      await syncApi.ping(Date.now());
      const elapsed = Math.max(1, Math.round(performance.now() - startTime));
      recordLatency(elapsed, 'cloud_ping', 'success');
      setIsMeasuringLatency(false);
      return elapsed;
    } catch (err) {
      console.warn('[OfflineContext] Sync latency check failed:', err);
      recordLatency(0, 'cloud_ping', 'failed');
      setIsMeasuringLatency(false);
      return null;
    }
  }, [isEffectiveOnline, recordLatency]);

  // Periodic real-time background sync cycle (cloud database round-trip heartbeat)
  useEffect(() => {
    if (!isEffectiveOnline) {
      setSyncLatencyMs(null);
      return;
    }

    // Initial immediate measurement
    measureSyncLatency();

    const interval = setInterval(() => {
      // Only measure if document is active / visible to preserve performance
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        measureSyncLatency();
      }
    }, 7000);

    return () => clearInterval(interval);
  }, [isEffectiveOnline, measureSyncLatency]);

  useEffect(() => {
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);
    const handleStorage = (e: StorageEvent) => {
      if (e.key === OUTBOX_STORAGE_KEY && e.newValue) {
        try {
          setOutbox(JSON.parse(e.newValue));
        } catch {
          // ignore
        }
      }
      if (e.key === LAST_SYNCED_STORAGE_KEY) {
        setLastSyncedAt(e.newValue);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const persistOutbox = (items: OutboxItem[]) => {
    setOutbox(items);
    localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(items));
  };

  const updateLastSynced = (timestamp: string) => {
    setLastSyncedAt(timestamp);
    localStorage.setItem(LAST_SYNCED_STORAGE_KEY, timestamp);
  };

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (isEffectiveOnline) {
      addToast({
        title: language === 'th' ? 'กลับมาออนไลน์แล้ว' : 'Back Online',
        message: language === 'th' 
          ? 'ระบบเชื่อมต่ออินเทอร์เน็ตสำเร็จ ข้อมูลที่ค้างอยู่จะเริ่มซิงค์อัตโนมัติ' 
          : 'Reconnected successfully. Synchronizing pending transactions...',
        type: 'success'
      });
    } else {
      addToast({
        title: language === 'th' ? 'ระบบเข้าสู่โหมดออฟไลน์' : 'Offline Mode',
        message: language === 'th' 
          ? 'สัญญาณขัดข้องหรือปิดการเชื่อมต่อชั่วคราว ยอดขายจะเซฟเก็บใน IndexedDB อัตโนมัติ' 
          : 'Connection lost. Sales will be securely cached in local IndexedDB.',
        type: 'warning'
      });
    }
  }, [isEffectiveOnline, language, addToast]);

  const toggleSimulatedOffline = () => {
    setIsSimulatedOffline((prev) => !prev);
  };

  const queueOutboxItem = <T,>(
    type: 'order_transaction' | 'shift_movement' | 'stock_adjustment',
    idempotencyKey: string,
    payload: T
  ): OutboxItem<T> => {
    const item: OutboxItem<T> = {
      id: `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      idempotencyKey,
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
      syncState: 'queued',
    };

    const updated = [item, ...outbox];
    persistOutbox(updated);
    return item;
  };

  const triggerSync = useCallback(async () => {
    if (!isEffectiveOnline || isSyncing) return;
    const queuedItems = outbox.filter((item) => item.syncState === 'queued' || item.syncState === 'failed');
    if (queuedItems.length === 0) return;

    setIsSyncing(true);
    let currentOutbox = [...outbox];

    for (const item of queuedItems) {
      try {
        // Mark syncing
        currentOutbox = currentOutbox.map((i) =>
          i.id === item.id ? { ...i, syncState: 'syncing', attempts: i.attempts + 1 } : i
        );
        persistOutbox(currentOutbox);

        const syncStartTime = performance.now();
        const result = await syncApi.syncOutboxItem(item);
        const roundTripMs = Math.max(1, Math.round(performance.now() - syncStartTime));
        recordLatency(roundTripMs, 'outbox_sync', 'success');

        // Mark synced with server confirmed timestamp
        currentOutbox = currentOutbox.map((i) =>
          i.id === item.id
            ? {
                ...i,
                syncState: 'synced',
                serverConfirmedId: result.confirmedOrder.id,
                serverConfirmedAt: result.syncedAt,
              }
            : i
        );
        persistOutbox(currentOutbox);
      } catch (err: any) {
        console.error('[OfflineContext] Sync failure for item:', item.id, err);
        recordLatency(0, 'outbox_sync', 'failed');
        currentOutbox = currentOutbox.map((i) =>
          i.id === item.id
            ? {
                ...i,
                syncState: 'failed',
                lastError: err?.message || 'Server rejected synchronization request.',
              }
            : i
        );
        persistOutbox(currentOutbox);
      }
    }

    setIsSyncing(false);
    updateLastSynced(new Date().toISOString());
  }, [isEffectiveOnline, isSyncing, outbox, recordLatency]);

  // Auto-trigger sync when transitioning to online
  useEffect(() => {
    if (isEffectiveOnline && outbox.some((i) => i.syncState === 'queued')) {
      triggerSync();
    }
  }, [isEffectiveOnline, outbox, triggerSync]);

  const clearSyncedItems = () => {
    const remaining = outbox.filter((i) => i.syncState !== 'synced');
    persistOutbox(remaining);
  };

  const clearOutbox = () => {
    persistOutbox([]);
  };

  const pendingCount = outbox.filter((i) => i.syncState === 'queued' || i.syncState === 'failed').length;
  const syncedCount = outbox.filter((i) => i.syncState === 'synced').length;
  const failedCount = outbox.filter((i) => i.syncState === 'failed').length;

  // Derived latency statistics
  const successfulLatencies = syncLatencyHistory
    .filter((r) => r.status === 'success' && r.latencyMs > 0)
    .map((r) => r.latencyMs);

  const avgSyncLatencyMs = successfulLatencies.length > 0
    ? Math.round(successfulLatencies.reduce((a, b) => a + b, 0) / successfulLatencies.length)
    : (syncLatencyMs || 0);

  const minSyncLatencyMs = successfulLatencies.length > 0
    ? Math.min(...successfulLatencies)
    : (syncLatencyMs || 0);

  const maxSyncLatencyMs = successfulLatencies.length > 0
    ? Math.max(...successfulLatencies)
    : (syncLatencyMs || 0);

  const syncLatencyQuality = computeLatencyQuality(syncLatencyMs, isEffectiveOnline);

  return (
    <OfflineContext.Provider
      value={{
        isOnline: isEffectiveOnline,
        isSimulatedOffline,
        outbox,
        pendingCount,
        syncedCount,
        failedCount,
        isSyncing,
        lastSyncedAt,
        syncLatencyMs,
        syncLatencyQuality,
        syncLatencyHistory,
        avgSyncLatencyMs,
        minSyncLatencyMs,
        maxSyncLatencyMs,
        lastSyncCycleAt,
        isMeasuringLatency,
        measureSyncLatency,
        toggleSimulatedOffline,
        queueOutboxItem,
        triggerSync,
        clearSyncedItems,
        clearOutbox,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
};

export function useOffline(): OfflineContextType {
  const ctx = useContext(OfflineContext);
  if (!ctx) {
    throw new Error('useOffline must be used within an OfflineProvider');
  }
  return ctx;
}

[executed on device: cs-66110132733-default (42795147-9ac6-4409-8625-90b0742cdd82)]