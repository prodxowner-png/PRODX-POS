import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { getCurrentRequestContext } from '../http/request-context-storage.ts';

export type SqlQueryExecutor = {
  query<T extends QueryResultRow>(sql: string, parameters?: readonly unknown[]): Promise<{ rows: T[] }>;
};

export type TransactionalSqlExecutor = SqlQueryExecutor & {
  transaction<T>(work: (tx: SqlQueryExecutor) => Promise<T>): Promise<T>;
};

const setTransactionTenantContext = async (client: PoolClient): Promise<void> => {
  const context = getCurrentRequestContext();
  if (!context) return;

  // Values originate from the server-verified principal. true makes each
  // setting transaction-local, so it is reset automatically on COMMIT/ROLLBACK.
  await client.query(
    `SELECT set_config('app.organization_id', $1, true),
            set_config('app.store_id', $2, true),
            set_config('app.user_id', $3, true)`,
    [
      context.principal.organizationId,
      context.principal.storeId,
      context.principal.userId,
    ],
  );
};

const clientExecutor = (client: PoolClient): SqlQueryExecutor => ({
  query: async <T extends QueryResultRow>(sql: string, parameters: readonly unknown[] = []) => {
    const result = await client.query<T>(sql, [...parameters]);
    return { rows: result.rows };
  },
});

export const createTransactionalPostgresExecutor = (pool: Pool): TransactionalSqlExecutor => ({
  query: async <T extends QueryResultRow>(sql: string, parameters: readonly unknown[] = []) => {
    // Preserve the existing pre-authentication path for now. Its database
    // access must be constrained separately before tenant RLS is enabled.
    if (!getCurrentRequestContext()) {
      const result = await pool.query<T>(sql, [...parameters]);
      return { rows: result.rows };
    }

    // A standalone authenticated query still needs a transaction for SET LOCAL
    // semantics. Do not use pool.query after setting tenant state on a session.
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      await setTransactionTenantContext(client);
      const result = await client.query<T>(sql, [...parameters]);
      await client.query('COMMIT');
      return { rows: result.rows };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      throw error;
    } finally {
      client.release();
    }
  },
  transaction: async <T>(work: (tx: SqlQueryExecutor) => Promise<T>): Promise<T> => {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      await setTransactionTenantContext(client);
      const result = await work(clientExecutor(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      throw error;
    } finally {
      client.release();
    }
  },
});
