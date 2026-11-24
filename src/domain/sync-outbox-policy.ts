import type {
  OutboxItem,
  OutboxItemType,
  ShiftMovementOutboxPayload,
  StockAdjustmentOutboxPayload,
} from './sync';

export const DEFAULT_MAX_OUTBOX_ATTEMPTS = 5;
export const BASE_RETRY_BACKOFF_MS = 2_000;
export const MAX_RETRY_BACKOFF_MS = 60_000;

export const SUPPORTED_OFFLINE_SYNC_COMMAND_TYPES: ReadonlySet<OutboxItemType> = new Set([
  'order_transaction',
  'shift_movement',
  'stock_adjustment',
]);

const PERMANENT_CONFLICT_HTTP_STATUSES = new Set([400, 403, 404, 409, 422]);

const PERMANENT_CONFLICT_ERROR_CODES = new Set([
  'SYNC_COMMAND_UNSUPPORTED',
  'SYNC_IDEMPOTENCY_KEY_MISMATCH',
  'SYNC_PAYLOAD_INVALID',
  'DISCOUNT_NOT_AUTHORIZED',
  'DISCOUNT_SUPERVISOR_APPROVAL_REQUIRED',
  'CHECKOUT_VALIDATION_FAILED',
  'CHECKOUT_CONFLICT',
  'SHIFT_VALIDATION_FAILED',
  'SHIFT_CONFLICT',
  'INVENTORY_ADJUSTMENT_VALIDATION_FAILED',
  'INVENTORY_ADJUSTMENT_CONFLICT',
  'INVALID_INVENTORY_REASON',
  'FORBIDDEN',
]);

const ALLOWED_MANUAL_SHIFT_MOVEMENT_TYPES = new Set(['paid_in', 'paid_out', 'drawer_drop']);
const ALLOWED_STOCK_ADJUSTMENT_REASONS = new Set([
  'purchase_received',
  'transfer_in',
  'transfer_out',
  'audit_count_adjustment',
  'damaged_write_off',
]);

export class UnsupportedOfflineCommandError extends Error {
  readonly code = 'SYNC_COMMAND_UNSUPPORTED';

  constructor(type: string) {
    super(
      `Offline outbox command type "${type}" is not supported by /api/v1/sync/commands. Supported command types: order_transaction, shift_movement, stock_adjustment.`,
    );
    this.name = 'UnsupportedOfflineCommandError';
  }
}

export class InvalidOfflineCommandPayloadError extends Error {
  readonly code = 'SYNC_PAYLOAD_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidOfflineCommandPayloadError';
  }
}

export function isSupportedOfflineCommandType(type: string): type is OutboxItemType {
  return SUPPORTED_OFFLINE_SYNC_COMMAND_TYPES.has(type as OutboxItemType);
}

export function assertSupportedOfflineCommandType(type: string): asserts type is OutboxItemType {
  if (!isSupportedOfflineCommandType(type)) {
    throw new UnsupportedOfflineCommandError(type);
  }
}

export function isShiftMovementOutboxPayload(
  value: unknown,
): value is ShiftMovementOutboxPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.idempotencyKey !== 'string' || !candidate.idempotencyKey.trim()) return false;
  if (typeof candidate.shiftId !== 'string' || !candidate.shiftId.trim()) return false;
  if (typeof candidate.type !== 'string' || !ALLOWED_MANUAL_SHIFT_MOVEMENT_TYPES.has(candidate.type)) {
    return false;
  }
  if (typeof candidate.reason !== 'string' || !candidate.reason.trim()) return false;
  if (typeof candidate.amount !== 'object' || candidate.amount === null || Array.isArray(candidate.amount)) {
    return false;
  }
  const amount = candidate.amount as Record<string, unknown>;
  if (
    typeof amount.amountInCents !== 'number' ||
    !Number.isSafeInteger(amount.amountInCents) ||
    amount.amountInCents <= 0 ||
    amount.amountInCents > 999_999_999_999
  ) {
    return false;
  }
  if (typeof amount.currency !== 'string' || !/^[A-Z]{3}$/.test(amount.currency.trim())) return false;
  if (candidate.storeId !== undefined && (typeof candidate.storeId !== 'string' || !candidate.storeId.trim())) {
    return false;
  }
  if (
    candidate.performedByUserId !== undefined &&
    (typeof candidate.performedByUserId !== 'string' || !candidate.performedByUserId.trim())
  ) {
    return false;
  }
  return true;
}

export function isStockAdjustmentOutboxPayload(
  value: unknown,
): value is StockAdjustmentOutboxPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.idempotencyKey !== 'string' || !candidate.idempotencyKey.trim()) return false;
  if (!Array.isArray(candidate.productIds) || candidate.productIds.length === 0 || candidate.productIds.length > 200) {
    return false;
  }
  if (!candidate.productIds.every((id) => typeof id === 'string' && id.trim().length > 0)) return false;
  if (
    typeof candidate.quantityDelta !== 'number' ||
    !Number.isSafeInteger(candidate.quantityDelta) ||
    candidate.quantityDelta === 0 ||
    Math.abs(candidate.quantityDelta) > 2_147_483_647
  ) {
    return false;
  }
  if (typeof candidate.reason !== 'string' || !ALLOWED_STOCK_ADJUSTMENT_REASONS.has(candidate.reason)) {
    return false;
  }
  if (candidate.notes !== undefined && typeof candidate.notes !== 'string') return false;
  if (candidate.storeId !== undefined && (typeof candidate.storeId !== 'string' || !candidate.storeId.trim())) {
    return false;
  }
  if (
    candidate.requesterUserId !== undefined &&
    (typeof candidate.requesterUserId !== 'string' || !candidate.requesterUserId.trim())
  ) {
    return false;
  }
  return true;
}

export function assertValidOfflineCommandPayload(
  type: OutboxItemType,
  idempotencyKey: string,
  payload: unknown,
): void {
  assertSupportedOfflineCommandType(type);
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    throw new InvalidOfflineCommandPayloadError('Outbox idempotencyKey must be a non-empty string.');
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new InvalidOfflineCommandPayloadError(`Outbox ${type} payload must be a non-null object.`);
  }
  const candidate = payload as Record<string, unknown>;
  if (candidate.idempotencyKey !== undefined && candidate.idempotencyKey !== idempotencyKey) {
    throw new InvalidOfflineCommandPayloadError(
      'Outbox idempotencyKey must match the command payload idempotencyKey.',
    );
  }
  if (type === 'shift_movement' && !isShiftMovementOutboxPayload(payload)) {
    throw new InvalidOfflineCommandPayloadError('The shift_movement outbox payload is invalid.');
  }
  if (type === 'stock_adjustment' && !isStockAdjustmentOutboxPayload(payload)) {
    throw new InvalidOfflineCommandPayloadError('The stock_adjustment outbox payload is invalid.');
  }
}

/**
 * Strictly oldest-first (FIFO) causal ordering for outbox replay.
 * Uses `id` as a deterministic tie-breaker when timestamps match.
 */
export function sortOutboxFifo<T extends Pick<OutboxItem, 'createdAt' | 'id'>>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/**
 * Bounded exponential backoff delay in milliseconds.
 * Attempt 1 -> 2s, 2 -> 4s, 3 -> 8s, 4 -> 16s, 5 -> 32s, capped at 60s.
 */
export function computeRetryBackoffMs(
  attemptNumber: number,
  baseMs = BASE_RETRY_BACKOFF_MS,
  maxMs = MAX_RETRY_BACKOFF_MS,
): number {
  const safeAttempt = Math.max(1, Math.trunc(attemptNumber));
  const exponential = baseMs * 2 ** (safeAttempt - 1);
  return Math.min(maxMs, exponential);
}

export function isOutboxItemEligibleForSync(item: OutboxItem, nowMs = Date.now()): boolean {
  if (item.syncState === 'queued') {
    if (!item.nextRetryAt) return true;
    const retryAtMs = Date.parse(item.nextRetryAt);
    return Number.isNaN(retryAtMs) || retryAtMs <= nowMs;
  }

  if (item.syncState === 'failed') {
    const maxAttempts = item.maxAttempts ?? DEFAULT_MAX_OUTBOX_ATTEMPTS;
    if (item.attempts >= maxAttempts) {
      return false;
    }
    if (!item.nextRetryAt) return true;
    const retryAtMs = Date.parse(item.nextRetryAt);
    return Number.isNaN(retryAtMs) || retryAtMs <= nowMs;
  }

  return false;
}

export function selectOutboxItemsForReplay(
  items: readonly OutboxItem[],
  nowMs = Date.now(),
): OutboxItem[] {
  return sortOutboxFifo(items.filter((item) => isOutboxItemEligibleForSync(item, nowMs)));
}

export interface SyncFailureClassification {
  readonly kind: 'conflict' | 'transient';
  readonly status?: number;
  readonly code?: string;
  readonly message: string;
}

export function classifySyncFailure(error: unknown): SyncFailureClassification {
  const errObj =
    typeof error === 'object' && error !== null
      ? (error as { status?: unknown; code?: unknown; message?: unknown })
      : null;

  const status =
    typeof errObj?.status === 'number' && Number.isInteger(errObj.status)
      ? errObj.status
      : undefined;
  const code =
    typeof errObj?.code === 'string' && errObj.code.trim().length > 0
      ? errObj.code.trim()
      : undefined;
  const message =
    typeof errObj?.message === 'string' && errObj.message.trim().length > 0
      ? errObj.message.trim()
      : 'Server rejected synchronization request.';

  if (
    (status !== undefined && PERMANENT_CONFLICT_HTTP_STATUSES.has(status)) ||
    (code !== undefined && PERMANENT_CONFLICT_ERROR_CODES.has(code))
  ) {
    return { kind: 'conflict', status, code, message };
  }

  return { kind: 'transient', status, code, message };
}

export interface SyncFailureTransitionResult<T = unknown> {
  readonly updatedItem: OutboxItem<T>;
  readonly classification: SyncFailureClassification;
  readonly shouldSurfaceConflict: boolean;
  readonly transitionedToDeadLetter: boolean;
}

/**
 * Applies the deterministic post-failure state transition for an outbox item.
 * `attemptNumber` is the total number of attempts including the failure that just occurred.
 */
export function applySyncFailureTransition<T = unknown>(
  item: OutboxItem<T>,
  error: unknown,
  attemptNumber: number,
  nowMs = Date.now(),
): SyncFailureTransitionResult<T> {
  const classification = classifySyncFailure(error);
  const maxAttempts = item.maxAttempts ?? DEFAULT_MAX_OUTBOX_ATTEMPTS;

  if (classification.kind === 'conflict') {
    return {
      updatedItem: {
        ...item,
        attempts: attemptNumber,
        maxAttempts,
        syncState: 'conflict_requires_attention',
        nextRetryAt: undefined,
        lastError: classification.message,
        lastErrorCode: classification.code,
        lastHttpStatus: classification.status,
      },
      classification,
      shouldSurfaceConflict: true,
      transitionedToDeadLetter: false,
    };
  }

  if (attemptNumber >= maxAttempts) {
    return {
      updatedItem: {
        ...item,
        attempts: attemptNumber,
        maxAttempts,
        syncState: 'dead_letter',
        nextRetryAt: undefined,
        deadLetteredAt: new Date(nowMs).toISOString(),
        lastError: classification.message,
        lastErrorCode: classification.code,
        lastHttpStatus: classification.status,
      },
      classification,
      shouldSurfaceConflict: true,
      transitionedToDeadLetter: true,
    };
  }

  const backoffMs = computeRetryBackoffMs(attemptNumber);
  return {
    updatedItem: {
      ...item,
      attempts: attemptNumber,
      maxAttempts,
      syncState: 'failed',
      nextRetryAt: new Date(nowMs + backoffMs).toISOString(),
      lastError: classification.message,
      lastErrorCode: classification.code,
      lastHttpStatus: classification.status,
    },
    classification,
    shouldSurfaceConflict: false,
    transitionedToDeadLetter: false,
  };
}
