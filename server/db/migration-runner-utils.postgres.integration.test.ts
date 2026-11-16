import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresPool, resolveConfiguredDatabaseUrl } from './postgres';
import { recoverInvalidConcurrentIndex } from './migration-runner-utils';

const url = resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);
const pool = url ? createPostgresPool({ connectionString: url, max: 2 }) : null;
const suffix = String(process.pid);
const tableName = `prodx_migration_recovery_${suffix}`;
const indexName = `prodx_migration_recovery_${suffix}_idx`;
const migrationSql = `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${indexName} ON public.${tableName} (value);`;

test('recovers an invalid concurrent index in PostgreSQL and safely retries the migration', {
  skip: !pool,
}, async () => {
  assert.ok(pool);
  try {
    await pool.query(`CREATE TABLE public.${tableName} (value integer NOT NULL)`);
    await pool.query(`INSERT INTO public.${tableName}(value) VALUES (1), (1)`);

    await assert.rejects(pool.query(migrationSql), /could not create unique index|duplicate key value/i);

    const invalidBeforeRecovery = await pool.query(
      `SELECT i.indisvalid FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
       JOIN pg_namespace ns ON ns.oid = idx.relnamespace
       WHERE ns.nspname = 'public' AND idx.relname = $1`,
      [indexName],
    );
    assert.equal(invalidBeforeRecovery.rowCount, 1);
    assert.equal(invalidBeforeRecovery.rows[0].indisvalid, false);

    await recoverInvalidConcurrentIndex(migrationSql, async (sql, parameters) => {
      const result = await pool.query(sql, parameters ? [...parameters] : undefined);
      return { rowCount: result.rowCount };
    });

    const afterRecovery = await pool.query(
      'SELECT 1 FROM pg_class WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $1) AND relname = $2',
      ['public', indexName],
    );
    assert.equal(afterRecovery.rowCount, 0, 'invalid index must be removed before retry');

    await pool.query(`DELETE FROM public.${tableName} WHERE ctid IN (SELECT ctid FROM public.${tableName} LIMIT 1)`);
    await pool.query(migrationSql);

    const validAfterRetry = await pool.query(
      `SELECT i.indisvalid FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
       JOIN pg_namespace ns ON ns.oid = idx.relnamespace
       WHERE ns.nspname = 'public' AND idx.relname = $1`,
      [indexName],
    );
    assert.equal(validAfterRetry.rowCount, 1);
    assert.equal(validAfterRetry.rows[0].indisvalid, true);
  } finally {
    await pool.query(`DROP TABLE IF EXISTS public.${tableName}`);
    await pool.end();
  }
});
