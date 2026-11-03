export type MigrationQuery = (
  sql: string,
  parameters?: readonly unknown[],
) => Promise<{ rowCount: number | null }>;

export function isNonTransactionalMigration(sql: string): boolean {
  return /^\s*--\s*prodx:non-transactional\s*$/m.test(sql);
}

export function getConcurrentIndexName(sql: string): string | null {
  const match = /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z_][a-zA-Z0-9_$]*)/im.exec(sql);
  return match?.[1] ?? null;
}

export async function recoverInvalidConcurrentIndex(
  sql: string,
  query: MigrationQuery,
): Promise<void> {
  const indexName = getConcurrentIndexName(sql);
  if (!indexName) return;

  const invalid = await query(
    `SELECT 1
       FROM pg_class idx
       JOIN pg_namespace ns ON ns.oid = idx.relnamespace
       JOIN pg_index i ON i.indexrelid = idx.oid
      WHERE ns.nspname = 'public' AND idx.relname = $1 AND NOT i.indisvalid
      LIMIT 1`,
    [indexName],
  );

  if (invalid.rowCount === 1) {
    await query(`DROP INDEX CONCURRENTLY IF EXISTS public."${indexName}"`);
  }
}
