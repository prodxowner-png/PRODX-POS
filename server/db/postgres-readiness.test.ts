import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { assertPostgresReady } from './postgres-readiness.ts';

const fakePool = (query: (sql: string) => Promise<{ rows: Array<{ ok: number }> }>) =>
  ({ query }) as unknown as Pick<Pool, 'query'>;

test('probes the configured pool even when DATABASE_URL is absent', async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  let receivedSql = '';

  try {
    await assertPostgresReady(fakePool(async (sql) => {
      receivedSql = sql;
      return { rows: [{ ok: 1 }] };
    }));
    assert.equal(receivedSql, 'SELECT 1 AS ok');
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test('fails readiness on a PostgreSQL DNS error without exposing the host or connection details', async () => {
  const failure = Object.assign(new Error('getaddrinfo ENOTFOUND private-db.example'), {
    code: 'ENOTFOUND',
    syscall: 'getaddrinfo',
  });

  await assert.rejects(
    assertPostgresReady(fakePool(async () => { throw failure; })),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'PostgreSQL readiness check failed.');
      assert.equal((error as Error & { code?: string }).code, 'ENOTFOUND');
      assert.equal((error as Error & { syscall?: string }).syscall, 'getaddrinfo');
      assert.equal((error as Error & { stage?: string }).stage, 'database_query');
      assert.equal(error.message.includes('private-db.example'), false);
      return true;
    },
  );
});

test('fails closed when the PostgreSQL readiness query returns no successful row', async () => {
  await assert.rejects(
    assertPostgresReady(fakePool(async () => ({ rows: [] }))),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { code?: string }).code, 'READINESS_PROBE_FAILED');
      assert.equal((error as Error & { stage?: string }).stage, 'database_query');
      return true;
    },
  );
});
