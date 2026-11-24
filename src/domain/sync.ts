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

export interface ShiftMovementOutboxPayload {
  readonly idempotencyKey: string;
  readonly storeId?: string;
  readonly shiftId: string;
  readonly type: 'paid_in' | 'paid_out' | 'drawer_drop';
  readonly amount: {
    readonly amountInCents: number;
    readonly currency: string;
  };
  readonly reason: string;
  readonly performedByUserId?: string;
}

export interface StockAdjustmentOutboxPayload {
  readonly idempotencyKey: string;
  readonly storeId?: string;
  readonly productIds: readonly string[];
  readonly quantityDelta: number;
  readonly reason:
    | 'purchase_received'
    | 'transfer_in'
    | 'transfer_out'
    | 'audit_count_adjustment'
    | 'damaged_write_off';
  readonly notes?: string;
  readonly requesterUserId?: string;
}
