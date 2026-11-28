/**
 * A delayed session restore may publish or clear state only while the persisted
 * bearer it captured still identifies the session being restored.
 */
export const isCurrentSessionRestore = (
  expectedToken: string,
  latestPersistedToken: string | null | undefined,
  activeToken: string | null | undefined,
): boolean => expectedToken.length > 0
  && latestPersistedToken === expectedToken
  && (activeToken == null || activeToken === expectedToken);

/**
 * Cleanup may remove the captured token (or an already-cleared storage slot),
 * but must never remove a replacement token or a replacement active session.
 */
export const canClearRestoredSession = (
  expectedToken: string,
  latestPersistedToken: string | null | undefined,
  activeToken: string | null | undefined,
): boolean => expectedToken.length > 0
  && (latestPersistedToken == null || latestPersistedToken === expectedToken)
  && (activeToken == null || activeToken === expectedToken);
