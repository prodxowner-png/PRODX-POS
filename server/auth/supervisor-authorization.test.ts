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
      if (sql.includes('prodx_auth_find_supervisor_credential')) {
        return [{ userId: ids.supervisor, organizationId: ids.org, status: 'active', secretHash, failedAttempts: 0, lockedUntil: null }] as unknown as T[];
      }
      if (sql.includes('prodx_auth_reset_failed_attempts')) return [] as unknown as T[];
      if (sql.includes('SELECT m.user_id AS "userId"')) return [{ userId: ids.supervisor }] as unknown as T[];
      if (sql.includes('prodx_auth_record_failed_attempt')) return [] as unknown as T[];
      if (sql.includes('INSERT INTO prodx_supervisor_authorizations')) return [] as unknown as T[];
      if (sql.includes('prodx_record_security_audit_event')) return [] as unknown as T[];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const result = await createSupervisorAuthorizationService(db, () => new Date('2026-09-20T00:00:00.000Z')).authorize(input);
  assert.equal(result.supervisorUserId, ids.supervisor);
  assert.equal(new Date(result.expiresAt).toISOString(), '2026-09-20T00:02:00.000Z');
  assert.ok(calls.some((sql) => sql.includes('prodx_record_security_audit_event')));
  assert.ok(calls.some((sql) => sql.includes('INSERT INTO prodx_supervisor_authorizations')));
});

test('failed supervisor attempts use an atomic SQL increment and emit an audit event', async () => {
  const calls: string[] = [];
  const db: SqlExecutor = {
    async query<T extends Record<string, unknown>>(sql: string): Promise<readonly T[]> {
      calls.push(sql);
      if (sql.includes('prodx_auth_find_supervisor_credential')) {
        return [{ userId: ids.supervisor, organizationId: ids.org, status: 'active', secretHash: 'not-a-valid-hash', failedAttempts: 4, lockedUntil: null }] as unknown as T[];
      }
      if (sql.includes('prodx_auth_record_failed_attempt')) return [] as unknown as T[];
      if (sql.includes('prodx_record_security_audit_event')) return [] as unknown as T[];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  await assert.rejects(
    createSupervisorAuthorizationService(db, () => new Date('2026-09-20T00:00:00.000Z')).authorize(input),
    (error: unknown) => error instanceof SupervisorAuthorizationError && error.code === 'INVALID_CREDENTIALS',
  );
  assert.ok(calls.some((sql) => sql.includes('prodx_record_security_audit_event')));
});

test('supervisor authorization token is one-time and distinguishes replay from expiry', async () => {
  let consumeCount = 0;
  const db: SqlExecutor = {
    async query<T extends Record<string, unknown>>(sql: string): Promise<readonly T[]> {
      if (sql.includes('UPDATE prodx_supervisor_authorizations')) {
        consumeCount += 1;
        return consumeCount === 1 ? [{ supervisorUserId: ids.supervisor }] as unknown as T[] : [] as unknown as T[];
      }
      if (sql.includes('prodx_record_security_audit_event')) return [] as unknown as T[];
      if (sql.includes('SELECT consumed_at')) return [{ consumedAt: new Date(), expiresAt: new Date('2026-09-20T00:02:00.000Z') }] as unknown as T[];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const service = createSupervisorAuthorizationService(db);
  const consumeInput = { token: 'token', organizationId: ids.org, storeId: ids.store, requesterUserId: ids.requester, requesterSessionId: ids.session, action: 'refund' as const, orderId: ids.order };
  assert.deepEqual(await service.consume(consumeInput), { supervisorUserId: ids.supervisor });
  await assert.rejects(service.consume(consumeInput), (error: unknown) => error instanceof SupervisorAuthorizationError && error.code === 'AUTHORIZATION_REPLAYED');
});


test('supervisor authorization token is isolated by store and expires when no matching live authorization exists', async () => {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const db: SqlExecutor = {
    async query<T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []): Promise<readonly T[]> {
      calls.push({ sql, parameters });
      if (sql.includes('UPDATE prodx_supervisor_authorizations')) {
        const storeId = parameters[2];
        return storeId === ids.store
          ? [{ supervisorUserId: ids.supervisor }] as unknown as T[]
          : [] as unknown as T[];
      }
      if (sql.includes('prodx_record_security_audit_event')) return [] as unknown as T[];
      if (sql.includes('SELECT consumed_at')) {
        const storeId = parameters[2];
        return storeId === ids.store
          ? [{ consumedAt: null, expiresAt: new Date('2026-09-20T00:02:00.000Z') }] as unknown as T[]
          : [] as unknown as T[];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const service = createSupervisorAuthorizationService(db);
  const baseInput = {
    token: 'token',
    organizationId: ids.org,
    requesterUserId: ids.requester,
    requesterSessionId: ids.session,
    action: 'refund' as const,
    orderId: ids.order,
  };

  assert.deepEqual(
    await service.consume({ ...baseInput, storeId: ids.store }),
    { supervisorUserId: ids.supervisor },
  );
  await assert.rejects(
    service.consume({ ...baseInput, storeId: 'different-store' }),
    (error: unknown) => error instanceof SupervisorAuthorizationError && error.code === 'AUTHORIZATION_EXPIRED',
  );

  const differentStoreCalls = calls.filter(({ parameters }) => parameters[2] === 'different-store');
  assert.equal(differentStoreCalls.length, 2);
});

test('discount authorization consume binds the exact checkout payload and policy threshold', async () => {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const service = createSupervisorAuthorizationService({
    query: async <T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) => {
      calls.push({ sql, parameters });
      return [] as T[];
    },
  });
  await assert.rejects(service.consume({
    token: 'discount-token', organizationId: ids.org, storeId: ids.store, requesterUserId: ids.requester,
    requesterSessionId: ids.session, action: 'discount', checkoutIdempotencyKey: 'checkout-key',
    checkoutPayloadHash: 'a'.repeat(64), policyThresholdBps: 1750, policyRequiresApproval: true,
  }), (error: unknown) => error instanceof SupervisorAuthorizationError && error.code === 'AUTHORIZATION_EXPIRED');
  const consume = calls.find(({ sql }) => sql.startsWith('UPDATE prodx_supervisor_authorizations'));
  assert.ok(consume);
  assert.equal(consume.parameters[6], null);
  assert.equal(consume.parameters[7], 'checkout-key');
  assert.equal(consume.parameters[8], 'a'.repeat(64));
  assert.equal(consume.parameters[9], 1750);
  assert.equal(consume.parameters[10], true);
});
