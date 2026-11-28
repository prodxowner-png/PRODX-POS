/**
 * A renewal callback may mutate or expire a session only while its effect is
 * active and the exact POS bearer it captured is still the active bearer.
 */
export const isCurrentSessionRenewal = (
  disposed: boolean,
  activeToken: string | null | undefined,
  expectedToken: string,
): boolean => !disposed && expectedToken.length > 0 && activeToken === expectedToken;


export type SessionRenewalDecision =
  | { action: 'extend'; expiresAt: number }
  | { action: 'expire'; expiresAt: number };

export const getSessionRenewalDecision = (
  currentExpiresAt: string,
  renewedExpiresAt: string | null,
  now = Date.now(),
): SessionRenewalDecision => {
  const current = Date.parse(currentExpiresAt);
  if (!Number.isFinite(current)) return { action: 'expire', expiresAt: now };
  if (renewedExpiresAt === null) return { action: 'expire', expiresAt: current };

  const renewed = Date.parse(renewedExpiresAt);
  if (!Number.isFinite(renewed) || renewed <= now) return { action: 'expire', expiresAt: now };
  if (renewed > current) return { action: 'extend', expiresAt: renewed };
  return { action: 'expire', expiresAt: renewed };
};
