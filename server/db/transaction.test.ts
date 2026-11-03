import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { createTransactionalPostgresExecutor } from './transaction.ts';
import { runWithRequestContext } from '../http/request-context-storage.ts';

const context = {
  requestId: 'tenant-context-test',
  principal: { userId: 'user-1', organizationId: 'org-1', storeId: 'store-1' },
};

type Call = { scope: 'pool' | 'client'; sql: string; parameters: readonly unknown[] };

const fakePool = (failSql?: string) => {
  const calls: Call[] = [];
  const client = {
    query: async (sql: string, parameters: readonly unknown[] = []) => {
      calls.push({ scope: 'client', sql, parameters });
      if (sql === failSql) throw new Error('query failed');
      return { rows: sql === 'SELECT 1 AS ok' ? [{ ok: 1 }] : [] };
    },
    release: () => { calls.push({ scope: 'client', sql: 'RELEASE', parameters: [] }); },
  } as unknown as PoolClient;
  const pool = {
    connect: async () => {
      calls.push({ scope: 'pool', sql: 'CONNECT', parameters: [] });
      return client;
    },
    query: async (sql: string, parameters: readonly unknown[] = []) => {
      calls.push({ scope: 'pool', sql, parameters });
      return { rows: [{ ok: 1 }] };
    },
  } as unknown as Pool;
  return { pool, calls };
};

const tenantContextSql = `SELECT set_config('app.organization_id', $1, true),
            set_config('app.store_id', $2, true),
            set_config('app.user_id', $3, true)`;

test('authenticated standalone queries set server-derived tenant context transaction-locally', async () => {
  const { pool, calls } = fakePool();
  const executor = createTransactionalPostgresExecutor(pool);

  await runWithRequestContext(context, async () => {
    const result = await executor.query<{ ok: number }>('SELECT 1 AS ok');
    assert.deepEqual(result.rows, [{ ok: 1 }]);
  });

  assert.deepEqual(calls.map(({ scope, sql }) => `${scope}:${sql}`), [
    'pool:CONNECT',
    'client:BEGIN',
    `client:${tenantContextSql}`,
    'client:SELECT 1 AS ok',
    'client:COMMIT',
    'client:RELEASE',
  ]);
  assert.deepEqual(calls[2].parameters, ['org-1', 'store-1', 'user-1']);
});

test('authenticated multi-query transactions set tenant context once before work', async () => {
  const { pool, calls } = fakePool();
  const executor = createTransactionalPostgresExecutor(pool);

  await runWithRequestContext(context, async () => {
    await executor.transaction(async (tx) => {
      await tx.query('SELECT 1 AS ok');
      await tx.query('SELECT 1 AS ok');
    });
  });

  assert.equal(calls.filter((call) => call.sql === tenantContextSql).length, 1);
  assert.ok(calls.findIndex((call) => call.sql === tenantContextSql) < calls.findIndex((call) => call.sql === 'SELECT 1 AS ok'));
  assert.equal(calls.at(-2)?.sql, 'COMMIT');
  assert.equal(calls.at(-1)?.sql, 'RELEASE');
});

test('failed authenticated transactions roll back and always release the pooled connection', async () => {
  const { pool, calls } = fakePool('SELECT fail');
  const executor = createTransactionalPostgresExecutor(pool);

  await assert.rejects(
    runWithRequestContext(context, () => executor.transaction(async (tx) => {
      await tx.query('SELECT fail');
      return 'unreachable';
    })),
    /query failed/,
  );

  assert.ok(calls.some((call) => call.sql === 'ROLLBACK'));
  assert.equal(calls.at(-1)?.sql, 'RELEASE');
  assert.equal(calls.some((call) => call.sql === 'COMMIT'), false);
});

test('pre-authentication queries do not inherit a tenant context from another request', async () => {
  const { pool, calls } = fakePool();
  const executor = createTransactionalPostgresExecutor(pool);

  await executor.query('SELECT 1 AS ok');
  assert.deepEqual(calls.map(({ scope, sql }) => `${scope}:${sql}`), ['pool:SELECT 1 AS ok']);
});
