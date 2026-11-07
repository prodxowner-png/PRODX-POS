import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import { requirePermission } from './createApp';
import type { TransactionalSqlExecutor } from '../db/transaction';

const validPolicy = (value: unknown): value is { requireSupervisorApproval: boolean; maxDiscountWithoutApprovalBps: number } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return typeof body.requireSupervisorApproval === 'boolean' &&
    typeof body.maxDiscountWithoutApprovalBps === 'number' &&
    Number.isInteger(body.maxDiscountWithoutApprovalBps) &&
    body.maxDiscountWithoutApprovalBps >= 0 && body.maxDiscountWithoutApprovalBps <= 10000;
};

export const registerDiscountPolicyRoute = (app: Express, db: TransactionalSqlExecutor): void => {
  app.get('/api/v1/security/discount-policy', requirePermission('pos.discount'), async (request: Request, response: Response) => {
    const context = request.prodxContext;
    if (!context) { response.status(500).json({ error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.' } }); return; }
    const rows = await db.query<{ require_supervisor_approval: boolean; max_discount_without_approval_bps: number }>(
      `SELECT require_supervisor_approval, max_discount_without_approval_bps
         FROM prodx_discount_policies WHERE organization_id = $1 AND store_id = $2`,
      [context.principal.organizationId, context.principal.storeId],
    );
    if (!rows.rows[0]) { response.status(503).json({ error: { code: 'DISCOUNT_POLICY_MISSING', message: 'Store discount policy has not been provisioned.' } }); return; }
    response.json({ requireSupervisorApproval: rows.rows[0].require_supervisor_approval, maxDiscountWithoutApprovalBps: Number(rows.rows[0].max_discount_without_approval_bps) });
  });

  app.put('/api/v1/security/discount-policy', requirePermission('settings.manage'), async (request: Request, response: Response) => {
    const context = request.prodxContext;
    if (!context) { response.status(500).json({ error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.' } }); return; }
    if (!validPolicy(request.body)) { response.status(400).json({ error: { code: 'DISCOUNT_POLICY_INVALID', message: 'A boolean approval flag and integer threshold from 0 to 10000 basis points are required.' } }); return; }
    const result = await db.transaction(async (tx) => {
      const rows = await tx.query<{ require_supervisor_approval: boolean; max_discount_without_approval_bps: number }>(
        `UPDATE prodx_discount_policies
            SET require_supervisor_approval = $3,
                max_discount_without_approval_bps = $4,
                updated_by_user_id = $5,
                updated_at = CURRENT_TIMESTAMP
          WHERE organization_id = $1 AND store_id = $2
          RETURNING require_supervisor_approval, max_discount_without_approval_bps`,
        [context.principal.organizationId, context.principal.storeId, request.body.requireSupervisorApproval, request.body.maxDiscountWithoutApprovalBps, context.principal.userId],
      );
      if (!rows.rows[0]) return null;
      await tx.query(
        `SELECT public.prodx_record_security_audit_event($1, $2, $3, 'DISCOUNT_POLICY_UPDATED', $4::jsonb)`,
        [crypto.randomUUID(), context.principal.organizationId, context.principal.userId, JSON.stringify({ storeId: context.principal.storeId, requireSupervisorApproval: request.body.requireSupervisorApproval, maxDiscountWithoutApprovalBps: request.body.maxDiscountWithoutApprovalBps })],
      );
      return rows.rows[0];
    });
    if (!result) { response.status(503).json({ error: { code: 'DISCOUNT_POLICY_MISSING', message: 'Store discount policy has not been provisioned.' } }); return; }
    response.json({ requireSupervisorApproval: result.require_supervisor_approval, maxDiscountWithoutApprovalBps: Number(result.max_discount_without_approval_bps) });
  });
};
