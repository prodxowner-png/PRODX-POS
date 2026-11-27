import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { OutboxItem, OutboxItemType } from './sync';
import {
  BASE_RETRY_BACKOFF_MS,
  DEFAULT_MAX_OUTBOX_ATTEMPTS,
  InvalidOfflineCommandPayloadError,
  MAX_RETRY_BACKOFF_MS,
  UnsupportedOfflineCommandError,
  applySyncFailureTransition,
  assertSupportedOfflineCommandType,
  assertValidOfflineCommandPayload,
  classifySyncFailure,
  computeRetryBackoffMs,
  isOutboxItemEligibleForSync,
  isShiftMovementOutboxPayload,
  isStockAdjustmentOutboxPayload,
  isSupportedOfflineCommandType,
  selectOutboxItemsForReplay,
  sortOutboxFifo,
} from './sync-outbox-policy';
import { SyncApiError } from '../adapters/productionSyncApi';

const makeItem = (overrides: Partial<OutboxItem> = {}): OutboxItem => ({
  id: 'outbox-1',
  type: 'order_transaction',
  idempotencyKey: 'idem-1',
  payload: { idempotencyKey: 'idem-1' },
  createdAt: '2026-11-23T10:00:00.000Z',
  attempts: 0,
  maxAttempts: DEFAULT_MAX_OUTBOX_ATTEMPTS,
  syncState: 'queued',
  ...overrides,
});

test('FIFO causal replay selects oldest queued/failed items first across all command types, never LIFO', () => {
  const newest = makeItem({ id: 'outbox-3', type: 'stock_adjustment', createdAt: '2026-11-23T10:02:00.000Z' });
  const oldest = makeItem({ id: 'outbox-1', type: 'order_transaction', createdAt: '2026-11-23T10:00:00.000Z' });
  const middle = makeItem({ id: 'outbox-2', type: 'shift_movement', createdAt: '2026-11-23T10:01:00.000Z', syncState: 'failed', attempts: 1 });
  const synced = makeItem({ id: 'outbox-0', createdAt: '2026-11-23T09:59:00.000Z', syncState: 'synced' });
  const conflict = makeItem({ id: 'outbox-c', createdAt: '2026-11-23T09:58:00.000Z', syncState: 'conflict_requires_attention' });
  const deadLetter = makeItem({ id: 'outbox-d', createdAt: '2026-11-23T09:57:00.000Z', syncState: 'dead_letter', attempts: 5 });

  const fifoAll = sortOutboxFifo([newest, middle, oldest]);
  assert.deepEqual(
    fifoAll.map((i) => i.id),
    ['outbox-1', 'outbox-2', 'outbox-3'],
  );

  const replayOrder = selectOutboxItemsForReplay(
    [newest, synced, conflict, deadLetter, middle, oldest],
    Date.parse('2026-11-23T10:05:00.000Z'),
  );
  assert.deepEqual(
    replayOrder.map((i) => i.id),
    ['outbox-1', 'outbox-2', 'outbox-3'],
  );
});

test('permanent conflict errors (409, 403, 400, 422) for checkout, shift, and inventory transition to conflict_requires_attention and stop auto-retry', () => {
  const nowMs = Date.parse('2026-11-23T12:00:00.000Z');
  for (const [status, code] of [
    [409, 'CHECKOUT_CONFLICT'],
    [409, 'SHIFT_CONFLICT'],
    [409, 'INVENTORY_ADJUSTMENT_CONFLICT'],
    [403, 'DISCOUNT_NOT_AUTHORIZED'],
    [403, 'FORBIDDEN'],
    [400, 'SYNC_PAYLOAD_INVALID'],
    [400, 'SHIFT_VALIDATION_FAILED'],
    [400, 'INVENTORY_ADJUSTMENT_VALIDATION_FAILED'],
    [400, 'INVALID_INVENTORY_REASON'],
    [422, 'UNPROCESSABLE_ENTITY'],
  ] as const) {
    const err = new SyncApiError(`Rejected (${status})`, { status, code, requestId: 'req-1' });
    assert.equal(err.retryable, false);
    assert.equal(classifySyncFailure(err).kind, 'conflict');

    const result = applySyncFailureTransition(makeItem(), err, 1, nowMs);
    assert.equal(result.updatedItem.syncState, 'conflict_requires_attention');
    assert.equal(result.updatedItem.lastHttpStatus, status);
    assert.equal(result.updatedItem.lastErrorCode, code);
    assert.equal(result.updatedItem.nextRetryAt, undefined);
    assert.equal(result.shouldSurfaceConflict, true);
    assert.equal(result.transitionedToDeadLetter, false);
    assert.equal(isOutboxItemEligibleForSync(result.updatedItem, nowMs + 999_999), false);
  }
});

test('transient errors (503, network timeout) remain retryable with bounded exponential backoff and do not pop conflict dialog', () => {
  assert.equal(computeRetryBackoffMs(1), BASE_RETRY_BACKOFF_MS);
  assert.equal(computeRetryBackoffMs(2), BASE_RETRY_BACKOFF_MS * 2);
  assert.equal(computeRetryBackoffMs(3), BASE_RETRY_BACKOFF_MS * 4);
  assert.equal(computeRetryBackoffMs(4), BASE_RETRY_BACKOFF_MS * 8);
  assert.equal(computeRetryBackoffMs(10), MAX_RETRY_BACKOFF_MS);

  const nowMs = Date.parse('2026-11-23T12:00:00.000Z');
  const err503 = new SyncApiError('Service Unavailable', { status: 503, code: 'SERVICE_UNAVAILABLE' });
  assert.equal(err503.retryable, true);

  const t1 = applySyncFailureTransition(makeItem(), err503, 1, nowMs);
  assert.equal(t1.updatedItem.syncState, 'failed');
  assert.equal(t1.updatedItem.attempts, 1);
  assert.equal(t1.updatedItem.lastHttpStatus, 503);
  assert.equal(t1.updatedItem.nextRetryAt, new Date(nowMs + 2_000).toISOString());
  assert.equal(t1.shouldSurfaceConflict, false);
  assert.equal(t1.transitionedToDeadLetter, false);

  // Not eligible before backoff elapses; eligible at/after nextRetryAt
  assert.equal(isOutboxItemEligibleForSync(t1.updatedItem, nowMs + 1_999), false);
  assert.equal(isOutboxItemEligibleForSync(t1.updatedItem, nowMs + 2_000), true);

  // Network error without HTTP status is also transient
  const networkErr = new TypeError('Failed to fetch');
  const t2 = applySyncFailureTransition(t1.updatedItem, networkErr, 2, nowMs + 2_000);
  assert.equal(t2.updatedItem.syncState, 'failed');
  assert.equal(t2.updatedItem.attempts, 2);
  assert.equal(t2.updatedItem.nextRetryAt, new Date(nowMs + 2_000 + 4_000).toISOString());
  assert.equal(t2.shouldSurfaceConflict, false);
});

test('dead-letter quarantine stops automatic retry once maxAttempts is exhausted', () => {
  const nowMs = Date.parse('2026-11-23T12:10:00.000Z');
  const item = makeItem({ attempts: 4, maxAttempts: 5, syncState: 'failed' });
  const err503 = new SyncApiError('Upstream timeout', { status: 503 });

  const dead = applySyncFailureTransition(item, err503, 5, nowMs);
  assert.equal(dead.updatedItem.syncState, 'dead_letter');
  assert.equal(dead.updatedItem.attempts, 5);
  assert.equal(dead.updatedItem.deadLetteredAt, new Date(nowMs).toISOString());
  assert.equal(dead.updatedItem.nextRetryAt, undefined);
  assert.equal(dead.shouldSurfaceConflict, true);
  assert.equal(dead.transitionedToDeadLetter, true);
  assert.equal(isOutboxItemEligibleForSync(dead.updatedItem, nowMs + 3_600_000), false);
});

test('supported offline command types (order_transaction, shift_movement, stock_adjustment) pass while unsupported commands fail fast', () => {
  for (const supported of ['order_transaction', 'shift_movement', 'stock_adjustment'] as const) {
    assert.equal(isSupportedOfflineCommandType(supported), true);
    assert.doesNotThrow(() => assertSupportedOfflineCommandType(supported));
  }

  for (const unsupported of ['void_order', 'refund_transaction', 'open_shift', ''] as const) {
    assert.equal(isSupportedOfflineCommandType(unsupported), false);
    assert.throws(
      () => assertSupportedOfflineCommandType(unsupported as OutboxItemType),
      (err: unknown) =>
        err instanceof UnsupportedOfflineCommandError && err.code === 'SYNC_COMMAND_UNSUPPORTED',
    );
  }
});

test('assertValidOfflineCommandPayload validates shift_movement and stock_adjustment payloads and rejects invalid or server-only commands before queueing', () => {
  const validShiftPayload = {
    idempotencyKey: 'shift-idem-1',
    storeId: 'store-1',
    shiftId: 'shift-1',
    type: 'paid_in' as const,
    amount: { amountInCents: 2500, currency: 'THB' },
    reason: 'Petty cash replenishment',
    performedByUserId: 'user-1',
  };
  assert.equal(isShiftMovementOutboxPayload(validShiftPayload), true);
  assert.doesNotThrow(() =>
    assertValidOfflineCommandPayload('shift_movement', 'shift-idem-1', validShiftPayload),
  );

  // Server-generated shift movement types (cash_sale, cash_refund, opening_float) must be rejected before queueing
  for (const invalidShift of [
    { ...validShiftPayload, type: 'cash_sale' },
    { ...validShiftPayload, type: 'cash_refund' },
    { ...validShiftPayload, type: 'opening_float' },
    { ...validShiftPayload, amount: { amountInCents: 0, currency: 'THB' } },
    { ...validShiftPayload, amount: { amountInCents: -100, currency: 'THB' } },
    { ...validShiftPayload, amount: { amountInCents: 12.5, currency: 'THB' } },
    { ...validShiftPayload, amount: { amountInCents: 100, currency: 'thb' } },
    { ...validShiftPayload, reason: '   ' },
    { ...validShiftPayload, shiftId: '' },
  ]) {
    assert.equal(isShiftMovementOutboxPayload(invalidShift), false);
    assert.throws(
      () => assertValidOfflineCommandPayload('shift_movement', 'shift-idem-1', invalidShift),
      (err: unknown) =>
        err instanceof InvalidOfflineCommandPayloadError && err.code === 'SYNC_PAYLOAD_INVALID',
    );
  }

  const validStockPayload = {
    idempotencyKey: 'stock-idem-1',
    storeId: 'store-1',
    productIds: ['prod-1', 'prod-2'],
    quantityDelta: -3,
    reason: 'damaged_write_off' as const,
    notes: 'Damaged packaging during transit',
    requesterUserId: 'user-1',
  };
  assert.equal(isStockAdjustmentOutboxPayload(validStockPayload), true);
  assert.doesNotThrow(() =>
    assertValidOfflineCommandPayload('stock_adjustment', 'stock-idem-1', validStockPayload),
  );

  for (const invalidStock of [
    { ...validStockPayload, productIds: [] },
    { ...validStockPayload, productIds: [''] },
    { ...validStockPayload, quantityDelta: 0 },
    { ...validStockPayload, quantityDelta: 1.5 },
    { ...validStockPayload, reason: 'sale_deduction' },
    { ...validStockPayload, reason: 'offline_buffer_simulation_test' },
  ]) {
    assert.equal(isStockAdjustmentOutboxPayload(invalidStock), false);
    assert.throws(
      () => assertValidOfflineCommandPayload('stock_adjustment', 'stock-idem-1', invalidStock),
      (err: unknown) =>
        err instanceof InvalidOfflineCommandPayloadError && err.code === 'SYNC_PAYLOAD_INVALID',
    );
  }

  // Idempotency key mismatch between envelope and payload must be rejected
  assert.throws(
    () =>
      assertValidOfflineCommandPayload('stock_adjustment', 'other-key', validStockPayload),
    (err: unknown) =>
      err instanceof InvalidOfflineCommandPayloadError && err.code === 'SYNC_PAYLOAD_INVALID',
  );
});

test('end-to-end outbox lifecycle preserves idempotencyKey stability across retries, backoff, conflict, and completion for shift_movement and stock_adjustment', () => {
  const nowMs = Date.parse('2026-11-23T14:00:00.000Z');
  const shiftPayload = {
    idempotencyKey: 'shift-lifecycle-1',
    storeId: 'store-1',
    shiftId: 'shift-1',
    type: 'drawer_drop' as const,
    amount: { amountInCents: 5000, currency: 'THB' },
    reason: 'Safe drop',
  };
  assertValidOfflineCommandPayload('shift_movement', shiftPayload.idempotencyKey, shiftPayload);

  const shiftItem: OutboxItem = makeItem({
    id: 'outbox-shift-lifecycle-1',
    type: 'shift_movement',
    idempotencyKey: shiftPayload.idempotencyKey,
    payload: shiftPayload,
    createdAt: new Date(nowMs).toISOString(),
  });

  // 1. First attempt fails transiently (503) -> transitions to failed with backoff, preserving idempotencyKey & payload
  const transientErr = new SyncApiError('Gateway timeout', { status: 503, code: 'SERVICE_UNAVAILABLE' });
  const afterAttempt1 = applySyncFailureTransition(shiftItem, transientErr, 1, nowMs);
  assert.equal(afterAttempt1.updatedItem.syncState, 'failed');
  assert.equal(afterAttempt1.updatedItem.idempotencyKey, 'shift-lifecycle-1');
  assert.deepEqual(afterAttempt1.updatedItem.payload, shiftPayload);
  assert.equal(isOutboxItemEligibleForSync(afterAttempt1.updatedItem, nowMs + 1_000), false);
  assert.equal(isOutboxItemEligibleForSync(afterAttempt1.updatedItem, nowMs + BASE_RETRY_BACKOFF_MS), true);

  // 2. Stock adjustment rejected by server (409 INVENTORY_ADJUSTMENT_CONFLICT) -> transitions immediately to conflict_requires_attention
  const stockPayload = {
    idempotencyKey: 'stock-lifecycle-1',
    storeId: 'store-1',
    productIds: ['prod-1'],
    quantityDelta: -10,
    reason: 'audit_count_adjustment' as const,
  };
  assertValidOfflineCommandPayload('stock_adjustment', stockPayload.idempotencyKey, stockPayload);
  const stockItem: OutboxItem = makeItem({
    id: 'outbox-stock-lifecycle-1',
    type: 'stock_adjustment',
    idempotencyKey: stockPayload.idempotencyKey,
    payload: stockPayload,
    createdAt: new Date(nowMs + 500).toISOString(),
  });
  const conflictErr = new SyncApiError('Resulting stock cannot be negative', {
    status: 409,
    code: 'INVENTORY_ADJUSTMENT_CONFLICT',
  });
  const afterConflict = applySyncFailureTransition(stockItem, conflictErr, 1, nowMs + 500);
  assert.equal(afterConflict.updatedItem.syncState, 'conflict_requires_attention');
  assert.equal(afterConflict.updatedItem.idempotencyKey, 'stock-lifecycle-1');
  assert.equal(afterConflict.shouldSurfaceConflict, true);
  assert.equal(isOutboxItemEligibleForSync(afterConflict.updatedItem, nowMs + 60_000), false);
});

test('OfflineContext does not contain fabricated production sync activity seed data', () => {
  const sourcePath = path.resolve(import.meta.dirname, '../context/OfflineContext.tsx');
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.doesNotMatch(source, /getDefaultSyncActivitySeed/);
  assert.doesNotMatch(source, /ORD-2026-8812/);
  assert.doesNotMatch(source, /SHIFT-2026-004/);
  assert.doesNotMatch(source, /SKU-8821/);
});
