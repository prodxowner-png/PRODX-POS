import crypto from 'node:crypto';
import type { SqlQueryExecutor } from '../db/transaction';

export class AuditValidationError extends Error { readonly code = 'AUDIT_VALIDATION_FAILED'; }
type DbRow = Record<string, unknown>;

const clampLimit = (limit?: number): number => {
  if (limit === undefined) return 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new AuditValidationError('Limit must be an integer between 1 and 200.');
  }
  return limit;
};

const VALID_SEVERITIES = new Set(['info', 'warn', 'critical']);

export const createAuditReadService = (db: SqlQueryExecutor) => ({
  async getLogs(storeId: string, limit?: number) {
    if (!storeId?.trim()) throw new AuditValidationError('Store is required.');
    const result = await db.query<DbRow>(
      `SELECT a.id, a.store_id,
              COALESCE(r.code, '') AS register_id,
              a.user_id, COALESCE(u.display_name, '') AS user_name,
              a.action, a.severity, a.details, a.created_at
         FROM prodx_audit_log a
         LEFT JOIN prodx_registers r ON r.id = a.register_id AND r.store_id = a.store_id
         JOIN prodx_users u ON u.id = a.user_id AND u.organization_id = a.organization_id
        WHERE a.store_id = $1
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $2`,
      [storeId, clampLimit(limit)],
    );
    return result.rows.map((row) => ({
      id: row.id, storeId: row.store_id, registerId: row.register_id,
      userId: row.user_id, userName: row.user_name, action: row.action,
      severity: row.severity, details: row.details ?? {},
      timestamp: new Date(String(row.created_at)).toISOString(),
    }));
  },
  async recordEvent(input: {
    organizationId: string;
    storeId: string;
    userId: string;
    userName?: string;
    userRole?: string;
    registerId?: string;
    action: string;
    severity?: string;
    details?: unknown;
    sourceEventKey?: string;
  }) {
    const storeId = String(input.storeId ?? '').trim();
    const action = String(input.action ?? '').trim();
    const severity = String(input.severity ?? 'info').trim();
    if (!storeId) throw new AuditValidationError('Store is required.');
    if (!action || action.length > 120) throw new AuditValidationError('Audit action is required.');
    if (!VALID_SEVERITIES.has(severity)) throw new AuditValidationError('Audit severity must be info, warn, or critical.');
    const sourceEventKey = input.sourceEventKey?.trim() || null;
    if (sourceEventKey && sourceEventKey.length > 180) throw new AuditValidationError('Source event key cannot exceed 180 characters.');

    const payload =
      typeof input.details === 'string'
        ? { message: input.details }
        : input.details && typeof input.details === 'object'
        ? input.details
        : { message: String(input.details ?? '') };

    let resolvedRegisterUuid: string | null = null;
    const rawRegister = String(input.registerId ?? '').trim();
    if (rawRegister) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawRegister)) {
        const regCheck = await db.query<{ id: string }>(
          'SELECT id FROM prodx_registers WHERE id = $1 AND store_id = $2 LIMIT 1',
          [rawRegister, storeId],
        );
        resolvedRegisterUuid = regCheck.rows[0]?.id ?? null;
      } else {
        const regCheck = await db.query<{ id: string }>(
          'SELECT id FROM prodx_registers WHERE code = $1 AND store_id = $2 LIMIT 1',
          [rawRegister, storeId],
        );
        resolvedRegisterUuid = regCheck.rows[0]?.id ?? null;
      }
    }

    const id = crypto.randomUUID();
    const inserted = await db.query<{ id: string; created_at: Date | string }>(
      `INSERT INTO prodx_audit_log(id, organization_id, store_id, register_id, user_id, action, severity, details, source_event_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       ON CONFLICT DO NOTHING
       RETURNING id, created_at`,
      [
        id,
        input.organizationId,
        storeId,
        resolvedRegisterUuid,
        input.userId,
        action,
        severity,
        JSON.stringify(payload),
        sourceEventKey,
      ],
    );

    // A retried event must return the original persisted identity/time, not a
    // newly generated ID and timestamp for an INSERT that did nothing.
    let persisted = inserted.rows[0];
    if (!persisted && sourceEventKey) {
      const existing = await db.query<{ id: string; created_at: Date | string }>(
        `SELECT id, created_at
           FROM prodx_audit_log
          WHERE organization_id = $1 AND store_id = $2 AND source_event_key = $3
          LIMIT 1`,
        [input.organizationId, storeId, sourceEventKey],
      );
      persisted = existing.rows[0];
    }
    if (!persisted) {
      throw new Error('Audit event insert did not persist and no idempotent event was found.');
    }

    return {
      id: persisted.id,
      timestamp: new Date(persisted.created_at).toISOString(),
      storeId,
      registerId: rawRegister || undefined,
      userId: input.userId,
      userName: input.userName || 'Operator',
      userRole: input.userRole || 'cashier',
      action,
      severity,
      details: typeof input.details === 'string' ? input.details : JSON.stringify(payload),
    };
  },
});
