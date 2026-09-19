import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword } from './password';
import { createSupervisorAuthorizationService, SupervisorAuthorizationError } from './supervisor-authorization';
import type { SqlExecutor } from './postgres-repository';

const ids = {
  org: '00000000-0000-4000-8000-000000001001',
  store: '00000000-0000-4000-8000-000000001002',
  requester: '00000000-0000-4000-8000-000000001003',
  session: '00000000-0000-4000-8000-000000001004',
  supervisor: '00000000-0000-4000-8000-000000001005',
  order: '00000000-0000-4000-8000-000000001006',
};

const input = {
  organizationId: ids.org,
  storeId: ids.store,
  requesterUserId: ids.requester,
  requesterSessionId: ids.session,
  action: 'refund' as const,
  orderId: ids.order,
  supervisorUsername: 'supervisor',
  supervisorSecret: 'correct horse battery staple',
};

test('supervisor authorization issues scoped token and audit event atomically', async () => {
  const secretHash = await hashPassword(input.supervisorSecret);
  const calls: string[] = [];
  const db: SqlExecutor = {
    async query<T extends Record<string, unknown>>(sql: string): Promise<readonly T[]> {
      calls.push(sql);
      if (sql.includes('SELECT u.id AS "userId"')) {
        return [{ userId: ids.supervisor, organizationId: ids.org, status: 'active', secretHash, failedAttempts: 0, lockedUntil: null }] as unknown as T[];
      }
      if (sql.includes('SELECT m.user_id AS "userId"')) return [{ userId: ids.supervisor }] as unknown as T[];
      if (sql.includes('UPDATE prodx_user_credentials')) return [] as unknown as T[];
      if (sql.includes('INSERT INTO prodx_supervisor_authorizations')) return [] as unknown as T[];
      if (sql.includes('INSERT INTO prodx_security_audit_events')) return [] as unknown as T[];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const result = await createSupervisorAuthorizationService(db, () => new Date('2026-09-20T00:00:00.000Z')).authorize(input);
  assert.equal(result.supervisorUserId, ids.supervisor);
  assert.equal(new Date(result.expiresAt).toISOString(), '2026-09-20T00:02:00.000Z');
  assert.ok(calls.some((sql) => sql.includes('INSERT INTO prodx_security_audit_events')));
  assert.ok(calls.some((sql) => sql.includes('INSERT INTO prodx_supervisor_authorizations')));
});

test('failed supervisor attempts use an atomic SQL increment and emit an audit event', async () => {
  const calls: string[] = [];
  const db: SqlExecutor = {
    async query<T extends Record<string, unknown>>(sql: string): Promise<readonly T[]> {
      calls.push(sql);
      if (sql.includes('SELECT u.id AS "userId"')) {
        return [{ userId: ids.supervisor, organizationId: ids.org, status: 'active', secretHash: 'not-a-valid-hash', failedAttempts: 4, lockedUntil: null }] as unknown as T[];
      }
      if (sql.includes('UPDATE prodx_user_credentials')) return [] as unknown as T[];
      if (sql.includes('INSERT INTO prodx_security_audit_events')) return [] as unknown as T[];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  await assert.rejects(
    createSupervisorAuthorizationService(db, () => new Date('2026-09-20T00:00:00.000Z')).authorize(input),
    (error: unknown) => error instanceof SupervisorAuthorizationError && error.code === 'INVALID_CREDENTIALS',
  );
  const update = calls.find((sql) => sql.includes('UPDATE prodx_user_credentials')) ?? '';
  assert.match(update, /failed_attempts = failed_attempts \+ 1/);
  assert.match(update, /failed_attempts \+ 1 >=/);
  assert.ok(calls.some((sql) => sql.includes('INSERT INTO prodx_security_audit_events')));
});

test('supervisor authorization token is one-time and distinguishes replay from expiry', async () => {
  let consumeCount = 0;
  const db: SqlExecutor = {
    async query<T extends Record<string, unknown>>(sql: string): Promise<readonly T[]> {
      if (sql.includes('UPDATE prodx_supervisor_authorizations')) {
        consumeCount += 1;
        return consumeCount === 1 ? [{ supervisorUserId: ids.supervisor }] as unknown as T[] : [] as unknown as T[];
      }
      if (sql.includes('SELECT consumed_at')) return [{ consumedAt: new Date(), expiresAt: new Date('2026-09-20T00:02:00.000Z') }] as unknown as T[];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const service = createSupervisorAuthorizationService(db);
  const consumeInput = { token: 'token', organizationId: ids.org, storeId: ids.store, requesterUserId: ids.requester, requesterSessionId: ids.session, action: 'refund' as const, orderId: ids.order };
  assert.deepEqual(await service.consume(consumeInput), { supervisorUserId: ids.supervisor });
  await assert.rejects(service.consume(consumeInput), (error: unknown) => error instanceof SupervisorAuthorizationError && error.code === 'AUTHORIZATION_REPLAYED');
});
