import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AdminFirestoreSyncStatusService,
  computeConflictingFields,
} from './firestoreSyncStatusService';
import type { KeyValueStorageLike } from './organizationService';

class MemoryStorage implements KeyValueStorageLike {
  private map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

test('firestoreSyncStatusService — tracks pending Firestore writes and aggregates external queue metrics', () => {
  const storage = new MemoryStorage();
  const service = new AdminFirestoreSyncStatusService({ storage });

  service.enqueuePendingWrite({
    collection: 'organizations',
    documentId: 'org-prodx',
    entityName: 'PRODX Retail Group',
    operation: 'update',
    localPayload: { id: 'org-prodx', name: 'PRODX Retail Updated' },
    baseUpdatedAt: 1000,
  });

  service.enqueuePendingWrite({
    collection: 'branches',
    documentId: 'br-str-01',
    entityName: 'STR-01 Central World',
    operation: 'update',
    localPayload: { id: 'br-str-01', name: 'STR-01 Central World Flagship' },
    baseUpdatedAt: 1000,
  });

  service.updateExternalQueueMetrics({
    diagnosticBufferCount: 5,
    posOutboxPendingCount: 2,
  });

  const snap = service.getSnapshot();
  assert.equal(snap.FirestoreWriteQueueCount, 2);
  assert.equal(snap.diagnosticBufferCount, 5);
  assert.equal(snap.posOutboxPendingCount, 2);
  assert.equal(snap.pendingWritesCount, 9);
  assert.equal(snap.health, 'pending_queue');
  assert.equal(snap.conflictCount, 0);
});

test('firestoreSyncStatusService — detects offline buffer synchronization conflicts when remote document has newer updatedAt and diverging fields', async () => {
  const storage = new MemoryStorage();
  const committedPayloads: Record<string, unknown>[] = [];

  const service = new AdminFirestoreSyncStatusService({
    storage,
    remoteInspector: async (collectionName, docId) => {
      if (collectionName === 'branches' && docId === 'br-str-02') {
        return {
          id: 'br-str-02',
          name: 'STR-02 Nimman',
          updatedAt: 3000,
        };
      }
      if (collectionName === 'terminals' && docId === 'term-001') {
        // Cloud document was modified at t=5000 while local edit was based on t=2000
        return {
          id: 'term-001',
          name: 'Main Checkout Counter 1 (Cloud Version)',
          ipAddress: '192.168.1.101',
          paperWidth: '80mm',
          updatedAt: 5000,
        };
      }
      return null;
    },
    remoteCommitter: async (_item, payload) => {
      if (payload) committedPayloads.push(payload);
    },
  });

  // 1. Enqueue a non-conflicting branch write
  service.enqueuePendingWrite({
    collection: 'branches',
    documentId: 'br-str-02',
    entityName: 'STR-02 Nimman',
    operation: 'update',
    baseUpdatedAt: 3000,
    localPayload: {
      id: 'br-str-02',
      name: 'STR-02 Nimman Updated',
      updatedAt: 3500,
    },
  });

  // 2. Enqueue a conflicting terminal write (baseUpdatedAt = 2000 < remote.updatedAt = 5000)
  service.enqueuePendingWrite({
    collection: 'terminals',
    documentId: 'term-001',
    entityName: 'Main Checkout Counter 1',
    operation: 'update',
    baseUpdatedAt: 2000,
    localPayload: {
      id: 'term-001',
      name: 'Main Checkout Counter 1 (Local Offline Edit)',
      ipAddress: '192.168.1.250',
      paperWidth: '58mm',
      updatedAt: 4000,
    },
  });

  const result = await service.processPendingWriteQueue();
  assert.equal(result.synced, 1);
  assert.equal(result.conflictsDetected, 1);
  assert.equal(result.failed, 0);

  const snap = service.getSnapshot();
  assert.equal(snap.health, 'conflict_alert');
  assert.equal(snap.conflictCount, 1);
  assert.equal(snap.conflicts[0].documentId, 'term-001');
  assert.deepEqual(
    snap.conflicts[0].conflictingFields.sort(),
    ['ipAddress', 'name', 'paperWidth'],
  );

  // 3. Resolve conflict with 'merge' strategy
  const resolved = await service.resolveConflict(snap.conflicts[0].writeItemId, 'merge');
  assert.ok(resolved);
  assert.equal(resolved.status, 'synced');

  const afterSnap = service.getSnapshot();
  assert.equal(afterSnap.conflictCount, 0);
  assert.equal(afterSnap.health, 'synced');
  assert.equal(committedPayloads.length, 2);
});

test('firestoreSyncStatusService — computeConflictingFields accurately identifies diverging fields', () => {
  const diffs = computeConflictingFields(
    { id: 't1', name: 'POS A', ipAddress: '10.0.0.1', status: 'active' },
    { id: 't1', name: 'POS A', ipAddress: '10.0.0.99', status: 'maintenance' },
  );
  assert.deepEqual(diffs.sort(), ['ipAddress', 'status']);
});
