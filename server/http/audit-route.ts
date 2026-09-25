import type { Express, Request, Response } from 'express';
import { requirePermission } from './createApp';
import type { SqlQueryExecutor } from '../db/transaction';
import { AuditValidationError, createAuditReadService } from '../audit/audit-service';

export const registerAuditRoute = (
  app: Express,
  db: SqlQueryExecutor,
): void => {
  const service = createAuditReadService(db);

  app.get('/api/v1/audit/logs', requirePermission('audit:read'), async (request: Request, response: Response) => {
    try {
      const context = request.prodxContext;
      if (!context) {
        response.status(500).json({
          error: {
            code: 'REQUEST_CONTEXT_MISSING',
            message: 'Request context is required.',
            requestId: request.id,
          },
        });
        return;
      }

      const rawLimit = typeof request.query.limit === 'string' ? Number(request.query.limit) : undefined;
      response.json(await service.getLogs(context.principal.storeId, rawLimit));
    } catch (error) {
      if (error instanceof AuditValidationError) {
        response.status(400).json({
          error: { code: error.code, message: error.message, requestId: request.id },
        });
        return;
      }
      throw error;
    }
  });
};
