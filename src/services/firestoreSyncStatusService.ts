/**
 * PRODX POS — Firestore Write Queue & Offline Buffer Synchronization Conflict Service
 *
 * Tracks the queue of pending Firestore writes (Organization/Branch/Terminal mutations,
 * diagnostic batch writes, and offline outbox records) and detects/manages synchronization
 * conflicts between the local offline buffer and Cloud Firestore.
 */

import { doc, getDoc, setDoc, deleteDoc, Unsubscribe } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { KeyValueStorageLike } from '../domain/storage';

export type SyncEntityCollection =
  | 'organizations'
  | 'branches'
  | 'terminals'
  | 'audit_logs'
  | 'diagnostic_logs'
  | 'AppErrorLog'
  | 'admin_credentials'
  | 'orders';

export type PendingWriteOperation = 'create' | 'update' | 'delete';

export type PendingWriteStatus =
  | 'queued'
  | 'syncing'
  | 'conflict'
  | 'failed'
  | 'synced';

export type SyncConflictReason =
  | 'version_mismatch'
  | 'remote_modified_while_offline'
  | 'deleted_on_remote'
  | 'schema_constraint_violation';

export type SyncConflictResolutionStrategy = 'keep_local' | 'keep_cloud' | 'merge';

export interface PendingFirestoreWriteItem {
  id: string;
  collection: SyncEntityCollection;
  documentId: string;
  entityName: string;
  operation: PendingWriteOperation;
  status: PendingWriteStatus;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  idempotencyKey: string;
  baseUpdatedAt?: number;
  localPayload: Record<string, unknown>;
  remotePayload?: Record<string, unknown> | null;
  conflictReason?: SyncConflictReason;
  conflictDetectedAt?: number;
  conflictingFields?: string[];
  errorMessage?: string;
}

export interface FirestoreSyncConflictAlert {
  id: string;
  writeItemId: string;
  collection: SyncEntityCollection;
  documentId: string;
  entityName: string;
  operation: PendingWriteOperation;
  reason: SyncConflictReason;
  detectedAt: number;
  conflictingFields: string[];
  localPayload: Record<string, unknown>;
  remotePayload: Record<string, unknown> | null;
  summary: string;
}

export type OverallAdminSyncHealth =
  | 'synced'
  | 'syncing'
  | 'pending_queue'
  | 'conflict_alert'
  | 'offline_buffered';

export interface AdminFirestoreSyncStatusSnapshot {
  health: OverallAdminSyncHealth;
  isSyncing: boolean;
  isOfflineBufferActive: boolean;
  pendingWritesCount: number;
  FirestoreWriteQueueCount: number;
  diagnosticBufferCount: number;
  posOutboxPendingCount: number;
  conflictCount: number;
  failedCount: number;
  totalSyncedCount: number;
  lastSyncedAt: number | null;
  lastConflictDetectedAt: number | null;
  queue: PendingFirestoreWriteItem[];
  conflicts: FirestoreSyncConflictAlert[];
}

export type RemoteDocumentInspector = (
  collectionName: SyncEntityCollection,
  documentId: string,
) => Promise<Record<string, unknown> | null>;

export type RemoteDocumentCommitter = (
  item: PendingFirestoreWriteItem,
  finalPayload: Record<string, unknown> | null,
) => Promise<void>;

const STORAGE_KEYS = {
  WRITE_QUEUE: 'prodx.admin_sync.pending_writes.v1',
  TOTAL_SYNCED: 'prodx.admin_sync.total_synced.v1',
  LAST_SYNCED_AT: 'prodx.admin_sync.last_synced_at.v1',
} as const;

/**
 * Compares two payloads and returns the list of top-level keys whose values diverge.
 */
export function computeConflictingFields(
  localPayload: Record<string, unknown>,
  remotePayload: Record<string, unknown> | null | undefined,
): string[] {
  if (!remotePayload) {
    return Object.keys(localPayload).filter((k) => k !== 'id' && k !== 'createdAt');
  }
  const keys = new Set([
    ...Object.keys(localPayload),
    ...Object.keys(remotePayload),
  ]);
  const ignoredKeys = new Set(['id', 'createdAt', 'updatedAt']);
  const diffs: string[] = [];

  keys.forEach((key) => {
    if (ignoredKeys.has(key)) return;
    const localVal = JSON.stringify(localPayload[key]);
    const remoteVal = JSON.stringify(remotePayload[key]);
    if (localVal !== remoteVal) {
      diffs.push(key);
    }
  });

  return diffs;
}

async function defaultRemoteInspector(
  collectionName: SyncEntityCollection,
  documentId: string,
): Promise<Record<string, unknown> | null> {
  if (typeof window === 'undefined') return null;
  try {
    const snap = await getDoc(doc(db, collectionName, documentId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function defaultRemoteCommitter(
  item: PendingFirestoreWriteItem,
  finalPayload: Record<string, unknown> | null,
): Promise<void> {
  if (typeof window === 'undefined') return;
  if (item.operation === 'delete' || finalPayload === null) {
    await deleteDoc(doc(db, item.collection, item.documentId));
  } else {
    await setDoc(doc(db, item.collection, item.documentId), finalPayload);
  }
}

export class AdminFirestoreSyncStatusService {
  private queue: PendingFirestoreWriteItem[] = [];
  private isSyncing = false;
  private isOfflineBufferActive = false;
  private diagnosticBufferCount = 0;
  private posOutboxPendingCount = 0;
  private totalSyncedCount = 0;
  private lastSyncedAt: number | null = null;
  private lastConflictDetectedAt: number | null = null;
  private storage: KeyValueStorageLike | null = null;
  private remoteInspector: RemoteDocumentInspector = defaultRemoteInspector;
  private remoteCommitter: RemoteDocumentCommitter = defaultRemoteCommitter;
  private listeners = new Set<(snapshot: AdminFirestoreSyncStatusSnapshot) => void>();

  constructor(options?: {
    storage?: KeyValueStorageLike | null;
    remoteInspector?: RemoteDocumentInspector;
    remoteCommitter?: RemoteDocumentCommitter;
  }) {
    if (options?.storage !== undefined) {
      this.storage = options.storage;
    } else if (typeof window !== 'undefined' && window.localStorage) {
      this.storage = window.localStorage;
    }
    if (options?.remoteInspector) {
      this.remoteInspector = options.remoteInspector;
    }
    if (options?.remoteCommitter) {
      this.remoteCommitter = options.remoteCommitter;
    }
    this.hydrateFromStorage();
  }

  public configure(options: {
    storage?: KeyValueStorageLike | null;
    remoteInspector?: RemoteDocumentInspector;
    remoteCommitter?: RemoteDocumentCommitter;
    offlineMode?: boolean;
  }): void {
    if (options.storage !== undefined) {
      this.storage = options.storage;
      this.hydrateFromStorage();
    }
    if (options.remoteInspector) {
      this.remoteInspector = options.remoteInspector;
    }
    if (options.remoteCommitter) {
      this.remoteCommitter = options.remoteCommitter;
    }
    if (typeof options.offlineMode === 'boolean') {
      this.isOfflineBufferActive = options.offlineMode;
    }
    this.emit();
  }

  private hydrateFromStorage(): void {
    if (!this.storage) return;
    try {
      const rawQueue = this.storage.getItem(STORAGE_KEYS.WRITE_QUEUE);
      if (typeof rawQueue === 'string') {
        const parsed = JSON.parse(rawQueue);
        if (Array.isArray(parsed)) {
          this.queue = parsed;
        }
      }
      const rawTotal = this.storage.getItem(STORAGE_KEYS.TOTAL_SYNCED);
      if (typeof rawTotal === 'string') {
        const num = Number(rawTotal);
        if (Number.isFinite(num) && num >= 0) this.totalSyncedCount = num;
      }
      const rawLast = this.storage.getItem(STORAGE_KEYS.LAST_SYNCED_AT);
      if (typeof rawLast === 'string') {
        const ts = Number(rawLast);
        if (Number.isFinite(ts) && ts > 0) this.lastSyncedAt = ts;
      }
    } catch {
      // Ignore corrupt storage
    }
  }

  private persistToStorage(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEYS.WRITE_QUEUE, JSON.stringify(this.queue));
      this.storage.setItem(STORAGE_KEYS.TOTAL_SYNCED, String(this.totalSyncedCount));
      if (this.lastSyncedAt) {
        this.storage.setItem(STORAGE_KEYS.LAST_SYNCED_AT, String(this.lastSyncedAt));
      }
    } catch {
      // Ignore storage quota errors
    }
  }

  /**
   * Updates external queue counters (e.g., Diagnostic Buffer count from auditService
   * and Offline POS Outbox count from OfflineContext) so the Admin Console Sync Status
   * indicator reflects the unified pending write queue.
   */
  public updateExternalQueueMetrics(metrics: {
    diagnosticBufferCount?: number;
    posOutboxPendingCount?: number;
    isOffline?: boolean;
  }): void {
    let changed = false;
    if (
      typeof metrics.diagnosticBufferCount === 'number' &&
      metrics.diagnosticBufferCount !== this.diagnosticBufferCount
    ) {
      this.diagnosticBufferCount = Math.max(0, metrics.diagnosticBufferCount);
      changed = true;
    }
    if (
      typeof metrics.posOutboxPendingCount === 'number' &&
      metrics.posOutboxPendingCount !== this.posOutboxPendingCount
    ) {
      this.posOutboxPendingCount = Math.max(0, metrics.posOutboxPendingCount);
      changed = true;
    }
    if (
      typeof metrics.isOffline === 'boolean' &&
      metrics.isOffline !== this.isOfflineBufferActive
    ) {
      this.isOfflineBufferActive = metrics.isOffline;
      changed = true;
    }
    if (changed) {
      this.emit();
    }
  }

  /**
   * Enqueues a pending Firestore write operation into the local buffer.
   * Deduplicates by (collection + documentId) if an existing queued item is not yet synced.
   */
  public enqueuePendingWrite(input: {
    collection: SyncEntityCollection;
    documentId: string;
    entityName: string;
    operation: PendingWriteOperation;
    localPayload: Record<string, unknown>;
    baseUpdatedAt?: number;
    idempotencyKey?: string;
  }): PendingFirestoreWriteItem {
    const now = Date.now();
    const existingIdx = this.queue.findIndex(
      (item) =>
        item.collection === input.collection &&
        item.documentId === input.documentId &&
        item.status !== 'synced',
    );

    const record: PendingFirestoreWriteItem = {
      id:
        existingIdx >= 0
          ? this.queue[existingIdx].id
          : `fwq-${now.toString(36)}-${Math.random().toString(36).substring(2, 7)}`,
      collection: input.collection,
      documentId: input.documentId,
      entityName: input.entityName,
      operation: input.operation,
      status: 'queued',
      createdAt: existingIdx >= 0 ? this.queue[existingIdx].createdAt : now,
      updatedAt: now,
      attempts: existingIdx >= 0 ? this.queue[existingIdx].attempts : 0,
      idempotencyKey:
        input.idempotencyKey ||
        `idem-${input.collection}-${input.documentId}-${now.toString(36)}`,
      baseUpdatedAt: input.baseUpdatedAt,
      localPayload: input.localPayload,
    };

    if (existingIdx >= 0) {
      this.queue[existingIdx] = record;
    } else {
      this.queue.unshift(record);
    }

    this.persistToStorage();
    this.emit();
    return record;
  }

  /**
   * Registers a synchronization conflict when local offline buffered changes collide
   * with a newer or incompatible document state in Cloud Firestore.
   */
  public flagSynchronizationConflict(input: {
    writeItemId?: string;
    collection: SyncEntityCollection;
    documentId: string;
    entityName: string;
    operation?: PendingWriteOperation;
    reason?: SyncConflictReason;
    localPayload: Record<string, unknown>;
    remotePayload: Record<string, unknown> | null;
    errorMessage?: string;
  }): PendingFirestoreWriteItem {
    const now = Date.now();
    const conflictingFields = computeConflictingFields(input.localPayload, input.remotePayload);
    const reason: SyncConflictReason = input.reason || 'remote_modified_while_offline';

    const existingIdx = this.queue.findIndex(
      (item) =>
        (input.writeItemId && item.id === input.writeItemId) ||
        (item.collection === input.collection && item.documentId === input.documentId),
    );

    const item: PendingFirestoreWriteItem =
      existingIdx >= 0
        ? {
            ...this.queue[existingIdx],
            status: 'conflict',
            updatedAt: now,
            localPayload: input.localPayload,
            remotePayload: input.remotePayload,
            conflictReason: reason,
            conflictDetectedAt: now,
            conflictingFields,
            errorMessage:
              input.errorMessage ||
              `Synchronization conflict on ${input.collection}/${input.documentId}: remote document was modified while local offline buffer had uncommitted changes.`,
          }
        : {
            id:
              input.writeItemId ||
              `fwq-conf-${now.toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
            collection: input.collection,
            documentId: input.documentId,
            entityName: input.entityName,
            operation: input.operation || 'update',
            status: 'conflict',
            createdAt: now,
            updatedAt: now,
            attempts: 1,
            idempotencyKey: `idem-conflict-${input.collection}-${input.documentId}`,
            localPayload: input.localPayload,
            remotePayload: input.remotePayload,
            conflictReason: reason,
            conflictDetectedAt: now,
            conflictingFields,
            errorMessage:
              input.errorMessage ||
              `Synchronization conflict on ${input.collection}/${input.documentId}: remote document was modified while local offline buffer had uncommitted changes.`,
          };

    if (existingIdx >= 0) {
      this.queue[existingIdx] = item;
    } else {
      this.queue.unshift(item);
    }

    this.lastConflictDetectedAt = now;
    this.persistToStorage();
    this.emit();
    return item;
  }

  /**
   * Processes all queued pending writes against Cloud Firestore, automatically checking
   * for version/timestamp divergence before committing. Any item whose remote `updatedAt`
   * is newer than the local `baseUpdatedAt` with diverging fields is halted and marked as `'conflict'`.
   */
  public async processPendingWriteQueue(): Promise<{
    synced: number;
    conflictsDetected: number;
    failed: number;
  }> {
    if (this.isSyncing) {
      return { synced: 0, conflictsDetected: 0, failed: 0 };
    }

    const candidates = this.queue.filter(
      (item) => item.status === 'queued' || item.status === 'failed',
    );
    if (candidates.length === 0) {
      return { synced: 0, conflictsDetected: 0, failed: 0 };
    }

    this.isSyncing = true;
    this.emit();

    let synced = 0;
    let conflictsDetected = 0;
    let failed = 0;

    for (const candidate of candidates) {
      candidate.status = 'syncing';
      candidate.attempts += 1;
      candidate.updatedAt = Date.now();
      this.emit();

      try {
        const remoteDoc = await this.remoteInspector(
          candidate.collection,
          candidate.documentId,
        );

        // Detect optimistic concurrency / offline buffer conflict
        if (candidate.operation === 'update' && remoteDoc) {
          const remoteUpdatedAt =
            typeof remoteDoc.updatedAt === 'number'
              ? remoteDoc.updatedAt
              : typeof remoteDoc.createdAt === 'number'
              ? remoteDoc.createdAt
              : 0;

          const baseTs = candidate.baseUpdatedAt ?? 0;
          const diffFields = computeConflictingFields(candidate.localPayload, remoteDoc);

          if (baseTs > 0 && remoteUpdatedAt > baseTs && diffFields.length > 0) {
            candidate.status = 'conflict';
            candidate.remotePayload = remoteDoc;
            candidate.conflictReason = 'remote_modified_while_offline';
            candidate.conflictDetectedAt = Date.now();
            candidate.conflictingFields = diffFields;
            candidate.errorMessage = `Remote ${candidate.collection}/${candidate.documentId} was updated at ${new Date(remoteUpdatedAt).toISOString()} after local snapshot (${new Date(baseTs).toISOString()}). Diverging fields: ${diffFields.join(', ')}.`;
            this.lastConflictDetectedAt = Date.now();
            conflictsDetected += 1;
            continue;
          }
        }

        if (candidate.operation === 'update' && remoteDoc === null && candidate.baseUpdatedAt) {
          // Document was deleted on remote while edited offline
          candidate.status = 'conflict';
          candidate.remotePayload = null;
          candidate.conflictReason = 'deleted_on_remote';
          candidate.conflictDetectedAt = Date.now();
          candidate.conflictingFields = Object.keys(candidate.localPayload);
          candidate.errorMessage = `Remote document ${candidate.collection}/${candidate.documentId} was deleted on Cloud Firestore while modified in local offline buffer.`;
          this.lastConflictDetectedAt = Date.now();
          conflictsDetected += 1;
          continue;
        }

        await this.remoteCommitter(candidate, candidate.localPayload);
        candidate.status = 'synced';
        candidate.updatedAt = Date.now();
        synced += 1;
        this.totalSyncedCount += 1;
        this.lastSyncedAt = Date.now();
      } catch (err) {
        candidate.status = 'failed';
        candidate.errorMessage = err instanceof Error ? err.message : String(err);
        failed += 1;
      }
    }

    // Remove synced items from active pending queue
    this.queue = this.queue.filter((item) => item.status !== 'synced');
    this.isSyncing = false;
    this.persistToStorage();
    this.emit();

    return { synced, conflictsDetected, failed };
  }

  /**
   * Resolves a synchronization conflict using the administrator's chosen strategy:
   * - `'keep_local'`: Overwrites Cloud Firestore with the local offline buffer version.
   * - `'keep_cloud'`: Discards the conflicting local write and adopts the Cloud Firestore version.
   * - `'merge'`: Merges non-empty local fields over the Cloud Firestore version and commits.
   */
  public async resolveConflict(
    writeItemId: string,
    strategy: SyncConflictResolutionStrategy,
  ): Promise<PendingFirestoreWriteItem | null> {
    const idx = this.queue.findIndex((item) => item.id === writeItemId);
    if (idx < 0) return null;

    const item = this.queue[idx];
    const now = Date.now();

    if (strategy === 'keep_cloud') {
      this.queue.splice(idx, 1);
      this.lastSyncedAt = now;
      this.persistToStorage();
      this.emit();
      return item;
    }

    let resolvedPayload: Record<string, unknown> = {
      ...item.localPayload,
      updatedAt: now,
    };

    if (strategy === 'merge' && item.remotePayload) {
      resolvedPayload = {
        ...item.remotePayload,
        ...item.localPayload,
        id: item.documentId,
        updatedAt: now,
      };
    }

    try {
      await this.remoteCommitter(item, resolvedPayload);
    } catch {
      // Even if offline in preview, allow local resolution state update
    }

    this.queue.splice(idx, 1);
    this.totalSyncedCount += 1;
    this.lastSyncedAt = now;
    this.persistToStorage();
    this.emit();
    return {
      ...item,
      status: 'synced',
      localPayload: resolvedPayload,
      updatedAt: now,
    };
  }

  /**
   * Resolves all active conflicts using the specified strategy.
   */
  public async resolveAllConflicts(
    strategy: SyncConflictResolutionStrategy,
  ): Promise<number> {
    const conflictIds = this.queue
      .filter((item) => item.status === 'conflict')
      .map((item) => item.id);

    let count = 0;
    for (const id of conflictIds) {
      const res = await this.resolveConflict(id, strategy);
      if (res) count += 1;
    }
    return count;
  }

  /**
   * Simulates realistic pending Firestore writes and a synchronization conflict in the
   * local offline buffer so administrators can verify the visual alert and conflict resolution flow.
   */
  public simulateOfflineQueueAndConflict(): {
    queuedItems: PendingFirestoreWriteItem[];
    conflictItem: PendingFirestoreWriteItem;
  } {
    const now = Date.now();

    const queuedOrgWrite = this.enqueuePendingWrite({
      collection: 'branches',
      documentId: 'br-str-01',
      entityName: 'STR-01 Central World (Branch Profile)',
      operation: 'update',
      baseUpdatedAt: now - 120_000,
      localPayload: {
        id: 'br-str-01',
        orgId: 'org-prodx',
        name: 'STR-01 Central World Flagship',
        code: 'STR-01',
        address: 'Bangkok Flagship Central World, 4th Floor (Zone A)',
        manager: 'Somchai Prasert',
        status: 'active',
        updatedAt: now - 15_000,
      },
    });

    const queuedTerminalWrite = this.enqueuePendingWrite({
      collection: 'terminals',
      documentId: 'term-002',
      entityName: 'Express Lane Counter 2 (Terminal-002)',
      operation: 'update',
      baseUpdatedAt: now - 90_000,
      localPayload: {
        id: 'term-002',
        branchId: 'br-str-01',
        orgId: 'org-prodx',
        name: 'Express Lane Counter 2',
        code: 'Terminal-002',
        deviceModel: 'PAX E700 Integrated POS',
        ipAddress: '192.168.1.102',
        paperWidth: '80mm',
        status: 'active',
        updatedAt: now - 10_000,
      },
    });

    const conflictItem = this.flagSynchronizationConflict({
      collection: 'terminals',
      documentId: 'term-001',
      entityName: 'Main Checkout Counter 1 (Terminal-001)',
      operation: 'update',
      reason: 'remote_modified_while_offline',
      localPayload: {
        id: 'term-001',
        branchId: 'br-str-01',
        orgId: 'org-prodx',
        name: 'Main Checkout Counter 1 (Offline Local Edit)',
        code: 'Terminal-001',
        ipAddress: '192.168.1.210',
        paperWidth: '58mm',
        status: 'maintenance',
        updatedAt: now - 5_000,
      },
      remotePayload: {
        id: 'term-001',
        branchId: 'br-str-01',
        orgId: 'org-prodx',
        name: 'Main Checkout Counter 1 (Cloud Admin Update)',
        code: 'Terminal-001',
        ipAddress: '192.168.1.101',
        paperWidth: '80mm',
        status: 'active',
        updatedAt: now - 1_000,
      },
      errorMessage:
        'Sync Conflict on terminals/term-001: Local offline buffer modified [ipAddress, paperWidth, status, name] while Cloud Firestore received a newer commit.',
    });

    return {
      queuedItems: [queuedOrgWrite, queuedTerminalWrite],
      conflictItem,
    };
  }

  public clearQueue(): void {
    this.queue = [];
    this.persistToStorage();
    this.emit();
  }

  public getSnapshot(): AdminFirestoreSyncStatusSnapshot {
    const conflicts: FirestoreSyncConflictAlert[] = this.queue
      .filter((item) => item.status === 'conflict')
      .map((item) => ({
        id: `alert-${item.id}`,
        writeItemId: item.id,
        collection: item.collection,
        documentId: item.documentId,
        entityName: item.entityName,
        operation: item.operation,
        reason: item.conflictReason || 'remote_modified_while_offline',
        detectedAt: item.conflictDetectedAt || item.updatedAt,
        conflictingFields:
          item.conflictingFields ||
          computeConflictingFields(item.localPayload, item.remotePayload),
        localPayload: item.localPayload,
        remotePayload: item.remotePayload ?? null,
        summary:
          item.errorMessage ||
          `Synchronization conflict detected in ${item.collection}/${item.documentId}`,
      }));

    const firestoreWriteQueueCount = this.queue.filter(
      (item) => item.status === 'queued' || item.status === 'syncing' || item.status === 'failed',
    ).length;

    const failedCount = this.queue.filter((item) => item.status === 'failed').length;

    const pendingWritesCount =
      firestoreWriteQueueCount +
      this.diagnosticBufferCount +
      this.posOutboxPendingCount;

    let health: OverallAdminSyncHealth = 'synced';
    if (conflicts.length > 0) {
      health = 'conflict_alert';
    } else if (this.isSyncing) {
      health = 'syncing';
    } else if (this.isOfflineBufferActive) {
      health = 'offline_buffered';
    } else if (pendingWritesCount > 0 || failedCount > 0) {
      health = 'pending_queue';
    }

    return {
      health,
      isSyncing: this.isSyncing,
      isOfflineBufferActive: this.isOfflineBufferActive,
      pendingWritesCount,
      FirestoreWriteQueueCount: firestoreWriteQueueCount,
      diagnosticBufferCount: this.diagnosticBufferCount,
      posOutboxPendingCount: this.posOutboxPendingCount,
      conflictCount: conflicts.length,
      failedCount,
      totalSyncedCount: this.totalSyncedCount,
      lastSyncedAt: this.lastSyncedAt,
      lastConflictDetectedAt: this.lastConflictDetectedAt,
      queue: [...this.queue],
      conflicts,
    };
  }

  public subscribe(
    listener: (snapshot: AdminFirestoreSyncStatusSnapshot) => void,
  ): Unsubscribe {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snap = this.getSnapshot();
    this.listeners.forEach((listener) => {
      try {
        listener(snap);
      } catch {
        // Ignore listener errors
      }
    });
  }
}

export const firestoreSyncStatusService = new AdminFirestoreSyncStatusService();
