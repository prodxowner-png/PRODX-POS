/**
 * PRODX POS Domain - Offline Outbox & Synchronization Module
 * 
 * Invariant: Never pretend an offline transaction is server-committed.
 * Transactions created during connectivity drop are queued locally with
 * 'pending_sync_offline' status until authoritative server confirmation is received.
 */

export type OutboxItemType = 'order_transaction' | 'shift_movement' | 'stock_adjustment';

export type OutboxSyncState =
  | 'queued'
  | 'syncing'
  | 'synced'
  | 'failed'
  | 'conflict_requires_attention'
  | 'dead_letter';

export interface OutboxItem<T = unknown> {
  readonly id: string;
  readonly type: OutboxItemType;
  readonly idempotencyKey: string;
  readonly payload: T;
  readonly createdAt: string; // ISO 8601 UTC
  readonly attempts: number;
  readonly maxAttempts?: number;
  readonly syncState: OutboxSyncState;
  readonly nextRetryAt?: string; // ISO 8601 UTC
  readonly lastError?: string;
  readonly lastErrorCode?: string;
  readonly lastHttpStatus?: number;
  readonly deadLetteredAt?: string; // ISO 8601 UTC
  readonly serverConfirmedId?: string;
  readonly serverConfirmedAt?: string;
}
