export interface ShiftScope {
  readonly storeId: string;
  readonly registerId: string;
  readonly userId: string;
}

/** Identifies the exact authenticated scope for which a shift read was completed. */
export function getShiftScopeKey(scope: ShiftScope | null): string | null {
  if (!scope) return null;
  return JSON.stringify([scope.storeId, scope.registerId, scope.userId]);
}

/**
 * An unauthenticated screen has no POS shift to protect. For an authenticated
 * session, only a successful read for the current store/register/user is trusted.
 */
export function isShiftStateKnownForScope(
  currentScopeKey: string | null,
  loadedScopeKey: string | null,
): boolean {
  return currentScopeKey === null || currentScopeKey === loadedScopeKey;
}
