import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getConcurrentIndexName,
  isNonTransactionalMigration,
  recoverInvalidConcurrentIndex,
} from './migration-runner-utils';

test('recognizes only the explicit non-transactional migration marker', () => {
  assert.equal(isNonTransactionalMigration('-- prodx:non-transactional\nCREATE INDEX CONCURRENTLY x ON t (id);'), true);
  assert.equal(isNonTransactionalMigration('-- not-transactional\nCREATE INDEX x ON t (id);'), false);
  assert.equal(isNonTransactionalMigration('/* prodx:non-transactional */'), false);
});

test('extracts a constrained index identifier from concurrent index SQL', () => {
  assert.equal(getConcurrentIndexName('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_safe ON public.items (id);'), 'idx_safe');
  assert.equal(getConcurrentIndexName('CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_unique ON public.items (id);'), 'idx_unique');
  assert.equal(getConcurrentIndexName('CREATE INDEX IF NOT EXISTS idx_regular ON public.items (id);'), null);
  assert.equal(getConcurrentIndexName('CREATE INDEX CONCURRENTLY IF NOT EXISTS "unsafe-name" ON public.items (id);'), null);
});

test('drops only an invalid public concurrent index before retry', async () => {
  const calls: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
  await recoverInvalidConcurrentIndex(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS prodx_items_idx ON public.items (id);',
    async (sql, parameters) => {
      calls.push({ sql, parameters });
      return { rowCount: calls.length === 1 ? 1 : 0 };
    },
  );

  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /NOT i\.indisvalid/);
  assert.deepEqual(calls[0].parameters, ['prodx_items_idx']);
  assert.equal(calls[1].sql, 'DROP INDEX CONCURRENTLY IF EXISTS public."prodx_items_idx"');
});

test('keeps a valid or absent index untouched on retry', async () => {
  const calls: string[] = [];
  await recoverInvalidConcurrentIndex(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS prodx_items_idx ON public.items (id);',
    async (sql) => {
      calls.push(sql);
      return { rowCount: 0 };
    },
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0], /NOT i\.indisvalid/);
});
