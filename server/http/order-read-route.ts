import type { Express, NextFunction, Request, Response } from 'express';
import type { SqlQueryExecutor } from '../db/transaction';
import { createOrderReadService } from '../orders/order-read-service';
import { requirePermission } from './createApp';

const error = (response: Response, request: Request, status: number, code: string, message: string) =>
  response.status(status).json({ error: { code, message, requestId: request.id } });

export const registerOrderReadRoute = (
  app: Express,
  db: SqlQueryExecutor,
  permission = 'pos.sell',
): void => {
  const service = createOrderReadService(db);

  app.get('/api/v1/orders', requirePermission(permission), async (request: Request, response: Response, next: NextFunction) => {
    try {
      const context = request.prodxContext;
      if (!context) {
        return error(response, request, 500, 'REQUEST_CONTEXT_MISSING', 'Request context is required.');
      }

      const rawLimit = typeof request.query.limit === 'string' ? Number(request.query.limit) : 50;
      if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 200) {
        return error(response, request, 400, 'INVALID_LIMIT', 'limit must be an integer between 1 and 200.');
      }

      const rawRegisterId = typeof request.query.registerId === 'string'
        ? request.query.registerId.trim()
        : typeof request.query.terminalId === 'string'
          ? request.query.terminalId.trim()
          : undefined;

      return response.json(
        await service.getOrders(context.principal.organizationId, context.principal.storeId, rawLimit, rawRegisterId),
      );
    } catch (cause) {
      return next(cause);
    }
  });
};
