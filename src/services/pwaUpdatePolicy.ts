export type PwaUpdateBlocker =
  | 'offline'
  | 'outbox-loading'
  | 'syncing'
  | 'outbox-unresolved'
  | 'shift-loading'
  | 'shift-unknown'
  | 'active-shift'
  | 'inventory-mutation'
  | 'checkout-in-flight'
  | 'draft-cart';

export interface PwaUpdateSafetyState {
  readonly isOnline: boolean;
  readonly isOutboxReady: boolean;
  readonly isSyncing: boolean;
  readonly hasUnresolvedOutbox: boolean;
  readonly isShiftLoading: boolean;
  readonly isShiftStateKnown: boolean;
  readonly hasActiveShift: boolean;
  readonly hasInventoryMutationInFlight: boolean;
  readonly hasCheckoutInFlight: boolean;
  readonly hasDraftCart: boolean;
}

/**
 * Fail-closed update policy. Unknown durable state is never treated as safe.
 * All unresolved outbox states (queued, syncing, failed, or conflict), active
 * mutations, and in-memory draft/held carts block updates.
 */
export function getPwaUpdateBlockers(state: PwaUpdateSafetyState): PwaUpdateBlocker[] {
  const blockers: PwaUpdateBlocker[] = [];

  if (!state.isOnline) blockers.push('offline');
  if (!state.isOutboxReady) blockers.push('outbox-loading');
  if (state.isSyncing) blockers.push('syncing');
  if (state.hasUnresolvedOutbox) blockers.push('outbox-unresolved');
  if (state.isShiftLoading) blockers.push('shift-loading');
  if (!state.isShiftStateKnown) blockers.push('shift-unknown');
  if (state.hasActiveShift) blockers.push('active-shift');
  if (state.hasInventoryMutationInFlight) blockers.push('inventory-mutation');
  if (state.hasCheckoutInFlight) blockers.push('checkout-in-flight');
  if (state.hasDraftCart) blockers.push('draft-cart');

  return blockers;
}

export function canApplyPwaUpdate(state: PwaUpdateSafetyState): boolean {
  return getPwaUpdateBlockers(state).length === 0;
}
