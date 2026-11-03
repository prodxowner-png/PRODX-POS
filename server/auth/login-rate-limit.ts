import crypto from 'node:crypto';
import type { SqlExecutor } from './postgres-repository';

const WINDOW_MS = 10 * 60 * 1000;

export const fingerprintClient = (clientAddress: string): string =>
  crypto.createHash('sha256').update(clientAddress, 'utf8').digest('hex');

export type LoginThrottleDecision = { allowed: boolean; retryAfterSeconds?: number };

export const checkLoginThrottle = async (db: SqlExecutor, clientAddress: string, now = new Date()): Promise<LoginThrottleDecision> => {
  const fingerprint = fingerprintClient(clientAddress);
  const rows = await db.query<{ locked_until: Date | null; window_started_at: Date; failed_attempts: number }>(
    `SELECT * FROM public.prodx_auth_login_throttle_check($1, $2::timestamptz)`, [fingerprint, now]);
  const row = rows[0];
  if (!row) return { allowed: true };
  if (row.locked_until && row.locked_until > now) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((row.locked_until.getTime() - now.getTime()) / 1000)) };
  }
  if (now.getTime() - row.window_started_at.getTime() >= WINDOW_MS) {
    // The SECURITY DEFINER function atomically resets an expired window before returning its state.
  }
  return { allowed: true };
};

export const recordLoginFailure = async (db: SqlExecutor, clientAddress: string, now = new Date()): Promise<LoginThrottleDecision> => {
  const fingerprint = fingerprintClient(clientAddress);
  const rows = await db.query<{ failed_attempts: number; locked_until: Date | null }>(
    `SELECT * FROM public.prodx_auth_login_throttle_record_failure($1, $2::timestamptz)`, [fingerprint, now]);
  const row = rows[0];
  if (row?.locked_until && row.locked_until > now) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((row.locked_until.getTime() - now.getTime()) / 1000)) };
  }
  return { allowed: true };
};
