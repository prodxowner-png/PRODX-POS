import type { Express, Request, Response } from 'express';
import { requirePermission } from './createApp';
import type { SqlExecutor } from '../db/postgres';
export const registerAuditRoute = (app: Express, db: SqlExecutor, permission = 'reports.read'): void => {
  app.get('/api/v1/audit/logs', requirePermission(permission), async (request: Request, response: Response) => {
    const context = request.prodxContext;
    if (!context) { response.status(500).json({error:{code:'REQUEST_CONTEXT_MISSING',message:'Request context is required.',requestId:request.id}}); return; }
    const rawLimit = typeof request.query.limit === 'string' ? Number.parseInt(request.query.limit,10) : 50;
    const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit,1),200) : 50;
    const rows = (await db.query(
      `SELECT a.id,a.store_id,a.register_id,a.user_id,a.action,a.severity,a.details,a.created_at,
              u.name AS user_name
       FROM prodx_audit_log a
       JOIN prodx_users u ON u.id=a.user_id AND u.organization_id=a.organization_id
       WHERE a.organization_id=$1 AND a.store_id=$2
       ORDER BY a.created_at DESC,a.id DESC LIMIT $3`,
      [context.principal.organizationId,context.principal.storeId,limit],
    );
    response.json(rows.map((r:any)=>({id:r.id,storeId:r.store_id,registerId:r.register_id ?? '',userId:r.user_id,userName:r.user_name,
      action:r.action,severity:r.severity,details:r.details,timestamp:new Date(r.created_at).toISOString()})));
  });
};