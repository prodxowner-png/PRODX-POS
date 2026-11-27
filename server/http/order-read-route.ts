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

      const rawOffset = typeof request.query.offset === 'string' ? Number(request.query.offset) : 0;
      if (!Number.isInteger(rawOffset) || rawOffset < 0 || rawOffset > 100000) {
        return error(response, request, 400, 'INVALID_OFFSET', 'offset must be an integer between 0 and 100000.');
      }

      const parseTimestamp = (value: unknown): string | undefined => {
        if (value === undefined) return undefined;
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
          throw new TypeError('Timestamps must be ISO 8601 UTC values.');
        }
        const parsed = new Date(value);
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
          throw new TypeError('Timestamps must be valid ISO 8601 UTC values.');
        }
        return value;
      };
      let from: string | undefined;
      let to: string | undefined;
      try {
        from = parseTimestamp(request.query.from);
        to = parseTimestamp(request.query.to);
      } catch {
        return error(response, request, 400, 'INVALID_DATE_RANGE', 'from and to must be valid ISO 8601 UTC timestamps.');
      }
      if (from && to && Date.parse(from) > Date.parse(to)) {
        return error(response, request, 400, 'INVALID_DATE_RANGE', 'from must be earlier than or equal to to.');
      }

      const rawRegisterId = typeof request.query.registerId === 'string'
        ? request.query.registerId.trim()
        : typeof request.query.terminalId === 'string'
          ? request.query.terminalId.trim()
          : undefined;

      return response.json(
        await service.getOrders(context.principal.organizationId, context.principal.storeId, rawLimit, rawRegisterId, { from, to, offset: rawOffset }),
      );
    } catch (cause) {
      return next(cause);
    }
  });
};
