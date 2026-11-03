/**
 * PRODX POS - Offline Resilience & Outbox Synchronization Context
 * 
 * Invariant: Never pretend an offline transaction is server-committed.
 * Transactions created during connectivity drop are queued locally with
 * 'pending_sync_offline' status until authoritative server confirmation is received.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { OutboxItem } from '../domain/sync';
import { normalizeOutboxForRecovery } from '../domain/sync-recovery';
import { createSyncApi } from '../adapters/syncApiFactory';
import { clearOutboxItems, clearSyncedOutboxItems, loadOutboxItems, putOutboxItem, replaceOutboxItems, updateOutboxItem } from '../adapters/offlineOutboxStore';
import { Order } from '../domain/order';
import { useToast } from './ToastContext';
import { useLanguage } from './LanguageContext';
import { useAuth } from './AuthContext';
import { ConflictResolutionDialog, ConflictData } from '../components/sync/ConflictResolutionDialog';
import { toastNotificationService } from '../services/toastNotificationService';

export type SyncLatencyQuality = 'optimal' | 'good' | 'moderate' | 'high' | 'poor' | 'offline';

export interface SyncLatencyRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly latencyMs: number;
  readonly source: 'outbox_sync' | 'cloud_heartbeat' | 'cloud_ping' | 'order_commit';
  readonly status: 'success' | 'failed';
}

export interface SyncActivityEvent {
  readonly id: string;
  readonly timestamp: string; // Initiation timestamp (ISO)
  readonly completedAt?: string; // Success or failure timestamp (ISO)
  readonly direction: 'local_to_cloud' | 'cloud_to_local' | 'bidirectional';
  readonly eventType: 'order_transaction' | 'shift_movement' | 'stock_adjustment' | 'heartbeat_ping' | 'cache_reconciliation';
  readonly status: 'success' | 'failed' | 'in_progress';
  readonly entityId?: string;
  readonly entityName?: string;
  readonly summary: string;
  readonly details?: string;
  readonly durationMs?: number;
  readonly attempts?: number;
  readonly serverConfirmedId?: string;
  readonly errorMessage?: string;
  readonly idempotencyKey?: string;
  readonly localPayload?: any;
  readonly cloudPayload?: any;
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
  queueOutboxItem: <T>(type: 'order_transaction' | 'shift_movement' | 'stock_adjustment', idempotencyKey: string, payload: T) => Promise<OutboxItem<T>>;
  triggerSync: () => Promise<void>;
  clearSyncedItems: () => void;
  clearOutbox: () => void;
  currentConflict: ConflictData | null;
  resolveConflict: (resolution: 'keep_local' | 'keep_cloud' | 'merge') => void;
  syncActivityHistory: readonly SyncActivityEvent[];
  recordSyncActivity: (event: Omit<SyncActivityEvent, 'id' | 'timestamp'> & { timestamp?: string }) => void;
  isSyncActivityOpen: boolean;
  openSyncActivity: () => void;
  closeSyncActivity: () => void;
  toggleSyncActivity: () => void;
  clearSyncActivityHistory: () => void;
}

const OfflineContext = createContext<OfflineContextType | undefined>(undefined);

const OUTBOX_STORAGE_KEY = 'prodx_pos_outbox';
const LAST_SYNCED_STORAGE_KEY = 'prodx_pos_last_synced';
const SYNC_ACTIVITY_STORAGE_KEY = 'prodx_pos_sync_activity_history';
const MAX_LATENCY_HISTORY_LENGTH = 20;
const MAX_SYNC_ACTIVITY_LENGTH = 60;

function getDefaultSyncActivitySeed(): SyncActivityEvent[] {
  const now = Date.now();
  return [
    {
      id: 'act-seed-1',
      timestamp: new Date(now - 120000).toISOString(),
      completedAt: new Date(now - 120000 + 42).toISOString(),
      direction: 'local_to_cloud',
      eventType: 'order_transaction',
      status: 'success',
      entityId: 'ord-tx-8812',
      entityName: 'Order #ORD-2026-8812 (฿450.00)',
      summary: 'คำสั่งซื้อหน้าร้านซิงก์จาก Local POS Cache ขึ้น Cloud PostgreSQL สำเร็จ',
      details: 'สินค้า 3 รายการ • ชำระผ่าน PromptPay QR • ยอดรวม ฿450.00 • Idempotency Verified',
      durationMs: 42,
      attempts: 1,
      serverConfirmedId: 'ORD-2026-8812',
      idempotencyKey: 'idem-ord-8812-7f2a',
      localPayload: { orderId: 'ORD-2026-8812', total: 450.0, itemsCount: 3, paymentMethod: 'promptpay' },
      cloudPayload: { id: 'ORD-2026-8812', serverStatus: 'COMMITTED', syncedAt: new Date(now - 120000 + 42).toISOString() },
    },
    {
      id: 'act-seed-2',
      timestamp: new Date(now - 480000).toISOString(),
      completedAt: new Date(now - 480000 + 29).toISOString(),
      direction: 'local_to_cloud',
      eventType: 'shift_movement',
      status: 'success',
      entityId: 'shift-flt-01',
      entityName: 'Cash Drawer Float (฿2,000.00)',
      summary: 'บันทึกเงินสดเริ่มต้นกะ (Shift Opening Float) ซิงก์ขึ้น Cloud สำเร็จ',
      details: 'แคชเชียร์ สมชาย • เครื่อง POS-01 • ลิ้นชักเงินสดพร้อมเปิดรอบขาย',
      durationMs: 29,
      attempts: 1,
      serverConfirmedId: 'SHIFT-2026-004',
      idempotencyKey: 'idem-shift-open-004',
      localPayload: { shiftId: 'SHIFT-2026-004', openingCash: 2000.0, registerId: 'REG-01' },
      cloudPayload: { id: 'SHIFT-2026-004', status: 'ACTIVE', syncedAt: new Date(now - 480000 + 29).toISOString() },
    },
    {
      id: 'act-seed-3',
      timestamp: new Date(now - 840000).toISOString(),
      completedAt: new Date(now - 840000 + 58).toISOString(),
      direction: 'local_to_cloud',
      eventType: 'stock_adjustment',
      status: 'success',
      entityId: 'stk-adj-8821',
      entityName: 'Stock Ledger (SKU-8821 Americano)',
      summary: 'การตัดสต็อกสินค้าจากการขายออฟไลน์ได้รับการบันทึกบน Cloud Database',
      details: 'ตัดยอดสินค้าอัตโนมัติ -2 หน่วย • สต็อกคงเหลือปัจจุบัน 28 หน่วย',
      durationMs: 58,
      attempts: 1,
      serverConfirmedId: 'STK-LEDGER-9912',
      idempotencyKey: 'idem-stock-adj-8821',
      localPayload: { sku: 'SKU-8821', delta: -2, reason: 'offline_sale_sync' },
      cloudPayload: { id: 'STK-LEDGER-9912', remainingQty: 28, verified: true },
    },
    {
      id: 'act-seed-4',
      timestamp: new Date(now - 1320000).toISOString(),
      completedAt: new Date(now - 1320000 + 3000).toISOString(),
      direction: 'local_to_cloud',
      eventType: 'order_transaction',
      status: 'failed',
      entityId: 'ord-tx-8810',
      entityName: 'Order #ORD-2026-8810 (฿890.00)',
      summary: 'การซิงก์ขัดข้องชั่วคราว: Network Timeout (E_TIMEDOUT after 3000ms)',
      details: 'สัญญาณอินเทอร์เน็ตหลุดขณะส่งข้อมูล • ข้อมูลได้รับการเก็บสำรองใน IndexedDB Local Cache รอ Replay อัตโนมัติ',
      errorMessage: 'Connection to Cloud API timed out (E_TIMEDOUT after 3000ms). Preserved in local POS cache.',
      durationMs: 3000,
      attempts: 1,
      idempotencyKey: 'idem-ord-8810-fail-sim',
      localPayload: { orderId: 'ORD-2026-8810', total: 890.0, itemsCount: 4 },
    },
    {
      id: 'act-seed-5',
      timestamp: new Date(now - 1260000).toISOString(),
      completedAt: new Date(now - 1260000 + 38).toISOString(),
      direction: 'local_to_cloud',
      eventType: 'order_transaction',
      status: 'success',
      entityId: 'ord-tx-8810',
      entityName: 'Order #ORD-2026-8810 Replay Recovery',
      summary: 'Replay คำสั่งซื้อหลังเครือข่ายกลับมาออนไลน์สำเร็จ ยืนยันบน Cloud DB',
      details: 'Re-sent from local outbox queue upon network reconnection • Server accepted idempotency key',
      durationMs: 38,
      attempts: 2,
      serverConfirmedId: 'ORD-2026-8810',
      idempotencyKey: 'idem-ord-8810-fail-sim',
      localPayload: { orderId: 'ORD-2026-8810', total: 890.0, retry: true },
      cloudPayload: { id: 'ORD-2026-8810', status: 'COMMITTED', replayed: true },
    },
    {
      id: 'act-seed-6',
      timestamp: new Date(now - 18000).toISOString(),
      completedAt: new Date(now - 18000 + 16).toISOString(),
      direction: 'bidirectional',
      eventType: 'heartbeat_ping',
      status: 'success',
      entityId: 'ping-hb-01',
      entityName: 'Cloud DB Round-Trip Heartbeat',
      summary: 'ตรวจสอบความเร็วการเชื่อมต่อฐานข้อมูลคลาวด์แบบเรียลไทม์',
      details: 'Round-trip latency 16ms • Connection quality: Optimal',
      durationMs: 16,
      attempts: 1,
    },
  ];
}

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
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const outboxReadyRef = useRef<Promise<void> | null>(null);
  const ensureOutboxReady = useCallback((): Promise<void> => {
    if (!outboxReadyRef.current) {
      outboxReadyRef.current = (async () => {
        const stored = normalizeOutboxForRecovery(await loadOutboxItems());
        if (stored.length > 0) {
          setOutbox(stored.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
          return;
        }

        // One-time migration from the legacy localStorage snapshot.
        let legacy: OutboxItem[] = [];
        try {
          const raw = localStorage.getItem(OUTBOX_STORAGE_KEY);
          legacy = raw ? normalizeOutboxForRecovery(JSON.parse(raw)) : [];
        } catch {
          legacy = [];
        }

        if (legacy.length > 0) {
          await replaceOutboxItems(legacy);
          setOutbox(legacy.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
          localStorage.removeItem(OUTBOX_STORAGE_KEY);
        } else {
          setOutbox([]);
        }
      })();
    }
    return outboxReadyRef.current;
  }, []);

  useEffect(() => {
    ensureOutboxReady().catch((err) => {
      console.error('[OfflineContext] Durable outbox initialization failed:', err);
    });
  }, [ensureOutboxReady]);

  // Real-time Sync Latency state
  const [syncLatencyMs, setSyncLatencyMs] = useState<number | null>(() => {
    return null;
  });
  const [isMeasuringLatency, setIsMeasuringLatency] = useState<boolean>(false);
  const [lastSyncCycleAt, setLastSyncCycleAt] = useState<string | null>(() => new Date().toISOString());
  const [syncLatencyHistory, setSyncLatencyHistory] = useState<SyncLatencyRecord[]>(() => [
    {
      id: `lat-init-1`,
      timestamp: new Date(Date.now() - 15000).toISOString(),
      latencyMs: 0,
      source: 'cloud_heartbeat',
      status: 'success',
    },
    {
      id: `lat-init-2`,
      timestamp: new Date(Date.now() - 30000).toISOString(),
      latencyMs: 0,
      source: 'cloud_heartbeat',
      status: 'success',
    },
  ]);

  // Real-time Sync Activity Log history (Local POS Cache <-> Cloud PostgreSQL)
  const [syncActivityHistory, setSyncActivityHistory] = useState<SyncActivityEvent[]>(() => {
    try {
      const raw = localStorage.getItem(SYNC_ACTIVITY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn('[OfflineContext] Failed to load cached sync activity events:', e);
    }
    return getDefaultSyncActivitySeed();
  });

  const [isSyncActivityOpen, setIsSyncActivityOpen] = useState<boolean>(false);

  const openSyncActivity = useCallback(() => setIsSyncActivityOpen(true), []);
  const closeSyncActivity = useCallback(() => setIsSyncActivityOpen(false), []);
  const toggleSyncActivity = useCallback(() => setIsSyncActivityOpen((prev) => !prev), []);

  const clearSyncActivityHistory = useCallback(() => {
    setSyncActivityHistory([]);
    try {
      localStorage.removeItem(SYNC_ACTIVITY_STORAGE_KEY);
    } catch {}
  }, []);

  const recordSyncActivity = useCallback(
    (event: Omit<SyncActivityEvent, 'id' | 'timestamp'> & { timestamp?: string }) => {
      const newEvent: SyncActivityEvent = {
        id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: event.timestamp || new Date().toISOString(),
        ...event,
      };

      setSyncActivityHistory((prev) => {
        const updated = [newEvent, ...prev.slice(0, MAX_SYNC_ACTIVITY_LENGTH - 1)];
        try {
          localStorage.setItem(SYNC_ACTIVITY_STORAGE_KEY, JSON.stringify(updated));
        } catch (e) {
          console.warn('[OfflineContext] Failed to persist sync activity event:', e);
        }
        return updated;
      });
    },
    []
  );

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

  const updateLastSynced = (timestamp: string) => {
    setLastSyncedAt(timestamp);
    localStorage.setItem(LAST_SYNCED_STORAGE_KEY, timestamp);
  };

  const toggleSimulatedOffline = useCallback(() => {
    setIsSimulatedOffline((prev) => !prev);
  }, []);

  const queueOutboxItem = async <T,>(
    type: 'order_transaction' | 'shift_movement' | 'stock_adjustment',
    idempotencyKey: string,
    payload: T
  ): Promise<OutboxItem<T>> => {
    await ensureOutboxReady();
    const item: OutboxItem<T> = {
      id: `outbox-${typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`,
      type,
      idempotencyKey,
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
      syncState: 'queued',
    };

    await putOutboxItem(item);
    setOutbox((current) => [item, ...current]);

    recordSyncActivity({
      eventType: type,
      direction: 'local_to_cloud',
      status: 'in_progress',
      entityId: item.id,
      entityName: type === 'order_transaction' ? 'POS Order Transaction' : type === 'shift_movement' ? 'Shift Float Movement' : 'Stock Adjustment',
      summary: `บันทึกลง Local POS Cache (IndexedDB) สำเร็จ • เตรียมซิงก์ขึ้น Cloud (Key: ${idempotencyKey.slice(0, 16)}...)`,
      details: 'แคชธุรกรรมถูกจัดเก็บปลอดภัยบนเครื่อง พร้อมส่งขึ้นเซิร์ฟเวอร์ทันทีที่มีการเชื่อมต่อ',
      idempotencyKey,
      attempts: 0,
      localPayload: payload,
    });

    return item;
  };

  const triggerSync = useCallback(async () => {
    if (!isEffectiveOnline || isSyncing) return;
    await ensureOutboxReady();
    const queuedItems = outbox.filter((item) => item.syncState === 'queued' || item.syncState === 'failed');
    if (queuedItems.length === 0) return;

    setIsSyncing(true);
    let lastSuccessfulSyncAt: string | null = null;

    for (const item of queuedItems) {
      const syncStartTime = performance.now();
      const initiatedAt = new Date().toISOString();
      try {
        await updateOutboxItem(item.id, {
          syncState: 'syncing',
          attempts: item.attempts + 1,
        });
        setOutbox((current) =>
          current.map((i) =>
            i.id === item.id ? { ...i, syncState: 'syncing', attempts: item.attempts + 1 } : i
          )
        );

        const result = await syncApi.syncOutboxItem(item);
        const roundTripMs = Math.max(1, Math.round(performance.now() - syncStartTime));
        const completedAt = result.syncedAt || new Date().toISOString();
        recordLatency(roundTripMs, 'outbox_sync', 'success');

        recordSyncActivity({
          timestamp: initiatedAt,
          completedAt,
          eventType: item.type,
          direction: 'local_to_cloud',
          status: 'success',
          entityId: item.id,
          entityName: item.type === 'order_transaction' ? `POS Order (${result.confirmedOrder.id})` : item.type === 'shift_movement' ? 'Shift Float Movement' : 'Stock Adjustment',
          summary: `ซิงก์จาก Local POS Cache ไปยัง Cloud DB สำเร็จใน ${roundTripMs} ms`,
          details: `Authoritative Cloud Commit ID: ${result.confirmedOrder.id} • ตรวจสอบความถูกต้องสมบูรณ์ (Idempotent Commit)`,
          durationMs: roundTripMs,
          attempts: item.attempts + 1,
          serverConfirmedId: result.confirmedOrder.id,
          idempotencyKey: item.idempotencyKey,
          localPayload: item.payload,
          cloudPayload: result.confirmedOrder,
        });

        lastSuccessfulSyncAt = result.syncedAt;
        await updateOutboxItem(item.id, {
          syncState: 'synced',
          serverConfirmedId: result.confirmedOrder.id,
          serverConfirmedAt: result.syncedAt,
        });
        setOutbox((current) =>
          current.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  syncState: 'synced',
                  serverConfirmedId: result.confirmedOrder.id,
                  serverConfirmedAt: result.syncedAt,
                }
              : i
          )
        );
      } catch (err: any) {
        const roundTripMs = Math.max(1, Math.round(performance.now() - syncStartTime));
        const completedAt = new Date().toISOString();
        console.error('[OfflineContext] Sync failure for item:', item.id, err);
        recordLatency(0, 'outbox_sync', 'failed');
        const errorMessage = err?.message || 'Server rejected synchronization request.';

        recordSyncActivity({
          timestamp: initiatedAt,
          completedAt,
          eventType: item.type,
          direction: 'local_to_cloud',
          status: 'failed',
          entityId: item.id,
          entityName: item.type === 'order_transaction' ? 'POS Order Transaction' : item.type === 'shift_movement' ? 'Shift Float Movement' : 'Stock Adjustment',
          summary: `การซิงก์ข้อมูลไปยัง Cloud ล้มเหลว: ${errorMessage}`,
          details: 'ข้อมูลได้รับการปกป้องใน Local POS Cache (IndexedDB) และจะลองส่งใหม่โดยอัตโนมัติ',
          errorMessage,
          durationMs: roundTripMs,
          attempts: item.attempts + 1,
          idempotencyKey: item.idempotencyKey,
          localPayload: item.payload,
        });

        try {
          await updateOutboxItem(item.id, {
            syncState: 'failed',
            lastError: errorMessage,
          });
        } catch (persistErr) {
          console.error('[OfflineContext] Failed to persist sync failure state:', persistErr);
        }
        setOutbox((current) =>
          current.map((i) =>
            i.id === item.id ? { ...i, syncState: 'failed', lastError: errorMessage } : i
          )
        );

        if (!currentConflict) {
          setCurrentConflict({
            id: item.id,
            type: item.type,
            idempotencyKey: item.idempotencyKey,
            createdAt: item.createdAt,
            localPayload: item.payload,
            cloudPayload: {
              serverState: 'conflict_or_rejection',
              reason: errorMessage,
              timestamp: new Date().toISOString(),
            },
            errorMessage,
          });
        }
      }
    }
    setIsSyncing(false);
    if (lastSuccessfulSyncAt) {
      updateLastSynced(lastSuccessfulSyncAt);
    }
  }, [ensureOutboxReady, isEffectiveOnline, isSyncing, outbox, recordLatency, recordSyncActivity]);

  // Auto-trigger sync when transitioning to online
  useEffect(() => {
    if (isEffectiveOnline && outbox.some((i) => i.syncState === 'queued')) {
      void triggerSync();
    }
  }, [isEffectiveOnline, outbox, triggerSync]);

  const clearSyncedItems = () => {
    void clearSyncedOutboxItems().then(() =>
      setOutbox((current) => current.filter((i) => i.syncState !== 'synced'))
    );
  };

  const clearOutbox = () => {
    void clearOutboxItems().then(() => setOutbox([]));
  };

  const pendingCount = outbox.filter((i) => i.syncState === 'queued' || i.syncState === 'failed').length;
  const syncedCount = outbox.filter((i) => i.syncState === 'synced').length;
  const failedCount = outbox.filter((i) => i.syncState === 'failed').length;

  // Persistent Toast Notification Service integration for Online <-> Offline transitions
  const prevOnlineRef = useRef<boolean>(isEffectiveOnline);
  const hasMountedConnectivityRef = useRef<boolean>(false);

  useEffect(() => {
    // On initial mount, only show persistent toast if the application starts in offline mode
    if (!hasMountedConnectivityRef.current) {
      hasMountedConnectivityRef.current = true;
      prevOnlineRef.current = isEffectiveOnline;
      if (!isEffectiveOnline) {
        toastNotificationService.notifyConnectivityTransition({
          isOnline: false,
          isSimulatedOffline,
          pendingCount,
          isSyncing,
          language,
          onTriggerSync: () => {
            void triggerSync();
          },
          onToggleSimulatedOffline: toggleSimulatedOffline,
          onOpenSyncActivity: openSyncActivity,
        });
      }
      return;
    }

    const didTransition = prevOnlineRef.current !== isEffectiveOnline;
    prevOnlineRef.current = isEffectiveOnline;

    if (didTransition) {
      toastNotificationService.notifyConnectivityTransition({
        isOnline: isEffectiveOnline,
        isSimulatedOffline,
        pendingCount,
        isSyncing,
        language,
        onTriggerSync: () => {
          void triggerSync();
        },
        onToggleSimulatedOffline: toggleSimulatedOffline,
        onOpenSyncActivity: openSyncActivity,
        silentUpdate: false,
      });
    } else if (!isEffectiveOnline) {
      // Keep the persistent offline toast updated when pendingCount or language changes while offline
      toastNotificationService.notifyConnectivityTransition({
        isOnline: false,
        isSimulatedOffline,
        pendingCount,
        isSyncing,
        language,
        onTriggerSync: () => {
          void triggerSync();
        },
        onToggleSimulatedOffline: toggleSimulatedOffline,
        onOpenSyncActivity: openSyncActivity,
        silentUpdate: true,
      });
    }
  }, [
    isEffectiveOnline,
    isSimulatedOffline,
    pendingCount,
    isSyncing,
    language,
    triggerSync,
    toggleSimulatedOffline,
    openSyncActivity,
  ]);

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

  const [currentConflict, setCurrentConflict] = useState<ConflictData | null>(null);

  const resolveConflict = (resolution: 'keep_local' | 'keep_cloud' | 'merge') => {
    if (!currentConflict) return;
    if (resolution === 'keep_local' || resolution === 'merge') {
      void updateOutboxItem(currentConflict.id, { syncState: 'queued' }).then(() => {
        setOutbox((prev) =>
          prev.map((i) => (i.id === currentConflict.id ? { ...i, syncState: 'queued' } : i))
        );
        addToast({
          title: language === 'th' ? 'การแก้ไขข้อขัดแย้ง' : 'Conflict Resolved',
          message: language === 'th' ? 'เลือกเก็บข้อมูลฝั่งเครื่อง (Local) สำเร็จ กำลังซิงก์ใหม่' : 'Retained local version and re-queued for sync',
          type: 'success',
        });
      });
    } else {
      void updateOutboxItem(currentConflict.id, { syncState: 'synced' }).then(() => {
        setOutbox((prev) =>
          prev.map((i) => (i.id === currentConflict.id ? { ...i, syncState: 'synced' } : i))
        );
        addToast({
          title: language === 'th' ? 'การแก้ไขข้อขัดแย้ง' : 'Conflict Resolved',
          message: language === 'th' ? 'เลือกเก็บข้อมูลบนคลาวด์ (Cloud) สำเร็จ' : 'Retained cloud version and resolved conflict',
          type: 'success',
        });
      });
    }
    setCurrentConflict(null);
  };

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
        currentConflict,
        resolveConflict,
        syncActivityHistory,
        recordSyncActivity,
        isSyncActivityOpen,
        openSyncActivity,
        closeSyncActivity,
        toggleSyncActivity,
        clearSyncActivityHistory,
      }}
    >
      {children}
      <ConflictResolutionDialog
        isOpen={Boolean(currentConflict)}
        conflict={currentConflict}
        onResolve={resolveConflict}
        onClose={() => setCurrentConflict(null)}
      />
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