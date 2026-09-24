import type { SqlQueryExecutor } from '../db/transaction';

export class AuditValidationError extends Error {
  readonly code = 'AUDIT_VALIDATION_FAILED';
}

type DbRow = Record<string, any>;

const clampLimit = (limit?: number): number => {
  if (limit === undefined) return 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new AuditValidationError('Limit must be an integer between 1 and 200.');
  }
  return limit;
};

export const createAuditReadService = (db: SqlQueryExecutor) => ({
  async getLogs(storeId: string, limit?: number) {
    if (!storeId?.trim()) throw new AuditValidationError('Store is required.');

    const result = await db.query<DbRow>(
      `SELECT a.id,
              a.store_id,
              COALESCE(r.code, '') AS register_id,
              a.user_id,
              COALESCE(u.display_name, '') AS user_name,
              a.action,
              a.severity,
              a.details,
              a.created_at
         FROM prodx_audit_log a
         LEFT JOIN prodx_registers r
           ON r.id = a.register_id
          AND r.store_id = a.store_id
         JOIN prodx_users u
           ON u.id = a.user_id
          AND u.organization_id = a.organization_id
        WHERE a.store_id = $1
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $2`,
      [storeId, clampLimit(limit)],
    );

    return result.rows.map((row) => ({
      id: row.id,
      storeId: row.store_id,
      registerId: row.register_id,
      userId: row.user_id,
      userName: row.user_name,
      action: row.action,
      severity: row.severity,
      details: row.details ?? {},
      timestamp: new Date(row.created_at).toISOString(),
    }));
  },
});
