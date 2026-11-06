/**
 * A renewal callback may mutate or expire a session only while its effect is
 * active and the exact POS bearer it captured is still the active bearer.
 */
export const isCurrentSessionRenewal = (
  disposed: boolean,
  activeToken: string | null | undefined,
  expectedToken: string,
): boolean => !disposed && expectedToken.length > 0 && activeToken === expectedToken;
