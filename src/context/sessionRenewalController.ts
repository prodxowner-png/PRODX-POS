import type { SessionContext } from '../domain/auth';
import { getSessionRenewalDecision, isCurrentSessionRenewal } from './sessionRenewalGuard';

type TimerHandle = ReturnType<typeof setTimeout>;
type RenewalFailure = { status: number | null; errorName: string };

export type SessionRenewalControllerOptions = {
  token: string;
  expiresAt: string;
  getActiveToken: () => string | null | undefined;
  renew: (token: string) => Promise<SessionContext | null>;
  onRenewed: (session: SessionContext) => void;
  logout: (token: string) => Promise<void>;
  onTransientError?: (failure: RenewalFailure) => void;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
};

const getFailure = (error: unknown): RenewalFailure => {
  const status = typeof error === 'object' && error !== null && 'status' in error
    && typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status
    : null;
  const candidateName = error instanceof Error ? error.name : '';
  const errorName = /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(candidateName) ? candidateName : 'Error';
  return { status, errorName };
};

export const startSessionRenewalController = ({
  token,
  expiresAt,
  getActiveToken,
  renew,
  onRenewed,
  logout,
  onTransientError = () => undefined,
  now = Date.now,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (handle) => clearTimeout(handle),
}: SessionRenewalControllerOptions): (() => void) => {
  let disposed = false;
  let timer: TimerHandle | undefined;
  const isActive = () => isCurrentSessionRenewal(disposed, getActiveToken(), token);
  const scheduleNext = (callback: () => void, delay: number) => {
    if (timer) cancel(timer);
    timer = schedule(callback, Math.max(0, delay));
  };
  const logoutIfCurrent = async () => {
    if (isActive()) await logout(token);
  };

  const attemptRenewal = async (): Promise<void> => {
    if (!isActive()) return;
    const currentExpiry = Date.parse(expiresAt);
    if (!Number.isFinite(currentExpiry) || currentExpiry <= now()) {
      await logoutIfCurrent();
      return;
    }

    try {
      const renewed = await renew(token);
      if (!isActive()) return;
      if (renewed && renewed.token !== token) {
        onTransientError({ status: null, errorName: 'SessionTokenMismatch' });
        await logoutIfCurrent();
        return;
      }
      const decision = getSessionRenewalDecision(expiresAt, renewed?.expiresAt ?? null, now());
      if (decision.action === 'extend' && renewed) {
        onRenewed(renewed);
        return;
      }
      const remaining = decision.expiresAt - now();
      if (remaining <= 0) {
        await logoutIfCurrent();
        return;
      }
      // A non-Supabase session or a renewal that did not extend expiry remains
      // valid only until the server-provided POS expiry.
      scheduleNext(() => { void logoutIfCurrent(); }, remaining);
      return;
    } catch (error) {
      if (!isActive()) return;
      const failure = getFailure(error);
      if (failure.status === 401 || failure.status === 403) {
        await logoutIfCurrent();
        return;
      }
      onTransientError(failure);
    }

    if (!isActive()) return;
    const remaining = currentExpiry - now();
    if (remaining <= 0) {
      await logoutIfCurrent();
      return;
    }
    scheduleNext(() => { void attemptRenewal(); }, Math.min(30_000, Math.max(1_000, remaining - 500)));
  };

  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) {
    void logoutIfCurrent();
  } else {
    scheduleNext(() => { void attemptRenewal(); }, Math.max(0, expiry - now() - 60_000));
  }

  return () => {
    disposed = true;
    if (timer) cancel(timer);
  };
};
