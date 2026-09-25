import type { Express, Request, Response } from 'express';
import { requirePermission } from './createApp';
import type { TransactionalSqlExecutor } from '../db/transaction';
import { createInventoryAdjustmentService, InventoryAdjustmentConflictError, InventoryAdjustmentValidationError } from '../inventory/inventory-adjustment-service';
import type { StockMovementReason } from '../../src/domain/catalog';

type Body = {
  productId?: string;
  productIds?: string[];
  quantityDelta?: number;
  reason?: StockMovementReason;
  idempotencyKey?: string;
};

const sendError = (response: Response, request: Request, status: number, code: string, message: string) => {
  response.status(status).json({ error: { code, message, requestId: request.id } });
};

export const registerInventoryAdjustmentRoute = (
  app: Express,
  db: TransactionalSqlExecutor,
): void => {
  const service = createInventoryAdjustmentService(db);

  app.post('/api/v1/inventory/adjustments', requirePermission('inventory:adjust'), async (request: Request, response: Response) => {
    try {
      const context = request.prodxContext;
      if (!context) {
        sendError(response, request, 500, 'REQUEST_CONTEXT_MISSING', 'Request context is required.');
        return;
      }
      const body = request.body as Body;
      if (!body || typeof body.productId !== 'string' || typeof body.quantityDelta !== 'number' || typeof body.reason !== 'string' || typeof body.idempotencyKey !== 'string') {
        sendError(response, request, 400, 'INVALID_REQUEST', 'Product, quantity delta, reason and idempotency key are required.');
        return;
      }
      const entry = await service.adjustStock(
        {
          organizationId: context.principal.organizationId,
          storeId: context.principal.storeId,
          userId: context.principal.userId,
        },
        body.productId,
        body.quantityDelta,
        body.reason,
        body.idempotencyKey,
      );
      response.status(200).json(entry);
    } catch (error) {
      if (error instanceof InventoryAdjustmentValidationError) {
        sendError(response, request, 400, error.code, error.message);
        return;
      }
      if (error instanceof InventoryAdjustmentConflictError) {
        sendError(response, request, 409, error.code, error.message);
        return;
      }
      throw error;
    }
  });

  app.post('/api/v1/inventory/adjustments/bulk', requirePermission('inventory:adjust'), async (request: Request, response: Response) => {
    try {
      const context = request.prodxContext;
      if (!context) {
        sendError(response, request, 500, 'REQUEST_CONTEXT_MISSING', 'Request context is required.');
        return;
      }
      const body = request.body as Body;
      if (!body || !Array.isArray(body.productIds) || typeof body.quantityDelta !== 'number' || typeof body.reason !== 'string' || typeof body.idempotencyKey !== 'string') {
        sendError(response, request, 400, 'INVALID_REQUEST', 'Product ids, quantity delta, reason and idempotency key are required.');
        return;
      }
      const entries = await service.bulkAdjustStock(
        {
          organizationId: context.principal.organizationId,
          storeId: context.principal.storeId,
          userId: context.principal.userId,
        },
        body.productIds,
        body.quantityDelta,
        body.reason,
        body.idempotencyKey,
      );
      response.status(200).json(entries);
    } catch (error) {
      if (error instanceof InventoryAdjustmentValidationError) {
        sendError(response, request, 400, error.code, error.message);
        return;
      }
      if (error instanceof InventoryAdjustmentConflictError) {
        sendError(response, request, 409, error.code, error.message);
        return;
      }
      throw error;
    }
  });
};
