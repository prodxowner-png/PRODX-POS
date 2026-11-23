import type { OutboxItem, OutboxItemType } from './sync';

export const DEFAULT_MAX_OUTBOX_ATTEMPTS = 5;
export const BASE_RETRY_BACKOFF_MS = 2_000;
export const MAX_RETRY_BACKOFF_MS = 60_000;

export const SUPPORTED_OFFLINE_SYNC_COMMAND_TYPES: ReadonlySet<OutboxItemType> = new Set([
  'order_transaction',
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
]);

export class UnsupportedOfflineCommandError extends Error {
  readonly code = 'SYNC_COMMAND_UNSUPPORTED';

  constructor(type: OutboxItemType) {
    super(
      `Offline outbox command type "${type}" is not supported by /api/v1/sync/commands. Only "order_transaction" commands can be queued for offline replay.`,
    );
    this.name = 'UnsupportedOfflineCommandError';
  }
}

export function isSupportedOfflineCommandType(type: OutboxItemType): boolean {
  return SUPPORTED_OFFLINE_SYNC_COMMAND_TYPES.has(type);
}

export function assertSupportedOfflineCommandType(type: OutboxItemType): void {
  if (!isSupportedOfflineCommandType(type)) {
    throw new UnsupportedOfflineCommandError(type);
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
