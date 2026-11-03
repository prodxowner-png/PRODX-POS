import assert from 'node:assert/strict';
import test from 'node:test';
import { checkLoginThrottle, fingerprintClient, recordLoginFailure, type LoginThrottleDecision } from './login-rate-limit';
import type { SqlExecutor } from './postgres-repository';

test('client fingerprints are deterministic and do not equal raw addresses', () => {
  assert.equal(fingerprintClient('203.0.113.10'), fingerprintClient('203.0.113.10'));
  assert.notEqual(fingerprintClient('203.0.113.10'), '203.0.113.10');
});

test('login throttle blocks after twenty failures without blocking the first nineteen', async () => {
  const state = { failedAttempts: 0, windowStartedAt: new Date('2026-10-05T00:00:00.000Z'), lockedUntil: null as Date | null };
  const db: SqlExecutor = {
    async query<T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []): Promise<readonly T[]> {
      if (sql.includes('prodx_auth_login_throttle_check')) {
        const now = parameters[1] as Date;
        if (state.failedAttempts === 0) return [] as T[];
        if (state.windowStartedAt.getTime() + 10 * 60 * 1000 <= now.getTime()) {
          state.failedAttempts = 0;
          state.lockedUntil = null;
          state.windowStartedAt = now;
        }
        return [{ failed_attempts: state.failedAttempts, window_started_at: state.windowStartedAt, locked_until: state.lockedUntil }] as unknown as T[];
      }
      if (sql.includes('prodx_auth_login_throttle_record_failure')) {
        const now = parameters[1] as Date;
        const expired = state.windowStartedAt.getTime() + 10 * 60 * 1000 <= now.getTime();
        state.failedAttempts = expired ? 1 : state.failedAttempts + 1;
        if (expired) state.windowStartedAt = now;
        state.lockedUntil = !expired && state.failedAttempts >= 20 ? new Date(now.getTime() + 60_000) : null;
        return [{ failed_attempts: state.failedAttempts, locked_until: state.lockedUntil }] as unknown as T[];
      }
      return [] as T[];
    },
  };
  const now = new Date('2026-10-05T00:00:00.000Z');
  let decision: LoginThrottleDecision = { allowed: true };
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    decision = await recordLoginFailure(db, '203.0.113.10', now);
    if (attempt < 20) assert.equal(decision.allowed, true);
  }
  assert.equal(decision.allowed, false);
  assert.ok((decision.retryAfterSeconds ?? 0) > 0);
  const blocked = await checkLoginThrottle(db, '203.0.113.10', now);
  assert.equal(blocked.allowed, false);
});
