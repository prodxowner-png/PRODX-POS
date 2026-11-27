export type PwaUpdateBlocker =
  | 'offline'
  | 'outbox-loading'
  | 'syncing'
  | 'outbox-unresolved'
  | 'shift-loading'
  | 'shift-unknown'
  | 'active-shift';

export interface PwaUpdateSafetyState {
  readonly isOnline: boolean;
  readonly isOutboxReady: boolean;
  readonly isSyncing: boolean;
  readonly hasUnresolvedOutbox: boolean;
  readonly isShiftLoading: boolean;
  readonly isShiftStateKnown: boolean;
  readonly hasActiveShift: boolean;
}

/**
 * Fail-closed update policy. Unknown durable state is never treated as safe.
 * All unresolved outbox states (queued, syncing, failed, or conflict) block updates.
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

  return blockers;
}

export function canApplyPwaUpdate(state: PwaUpdateSafetyState): boolean {
  return getPwaUpdateBlockers(state).length === 0;
}
