import type { Express, Request, Response } from 'express';
import type { CheckoutRequest } from '../../src/adapters/types';
import type { OutboxItem } from '../../src/domain/sync';
import { createCheckoutService, CheckoutConflictError, CheckoutValidationError } from '../transactions/checkout-service';
import { requirePermission } from './createApp';
import type { TransactionalSqlExecutor } from '../db/transaction';
import type { AuthorizeRequest } from './types';

type SyncCommandBody = {
  item: OutboxItem;
};

const parseBody = (value: unknown): SyncCommandBody => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CheckoutValidationError('Sync request body must be an object.');
  }
  const body = value as Record<string, unknown>;
  if (!body.item || typeof body.item !== 'object' || Array.isArray(body.item)) {
    throw new CheckoutValidationError('Sync request item is required.');
  }
  return { item: body.item as OutboxItem };
};

const isCheckoutRequest = (value: unknown): value is CheckoutRequest => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.idempotencyKey === 'string' &&
    typeof payload.registerId === 'string' &&
    Array.isArray(payload.items) &&
    Array.isArray(payload.payments) &&
    typeof payload.totals === 'object' &&
    payload.totals !== null
  );
};

export const registerSyncRoute = (
  app: Express,
  db: TransactionalSqlExecutor,
  permission = 'pos.sell',
): void => {
  const checkout = createCheckoutService(db);

  app.post('/api/v1/sync/commands', requirePermission(permission), async (request: Request, response: Response) => {
    try {
      const context = request.prodxContext;
      if (!context) {
        response.status(500).json({
          error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.', requestId: request.id },
        });
        return;
      }

      const { item } = parseBody(request.body);
      if (item.type !== 'order_transaction') {
        response.status(400).json({
          error: {
            code: 'SYNC_COMMAND_UNSUPPORTED',
            message: 'Only order_transaction outbox commands are supported by the production sync endpoint.',
            requestId: request.id,
          },
        });
        return;
      }

      const payloadIdempotencyKey = typeof item.payload === 'object' && item.payload !== null
        ? (item.payload as Record<string, unknown>).idempotencyKey
        : undefined;
      if (!item.idempotencyKey?.trim() || item.idempotencyKey !== payloadIdempotencyKey) {
        response.status(400).json({
          error: {
            code: 'SYNC_IDEMPOTENCY_KEY_MISMATCH',
            message: 'Outbox idempotency key must match the checkout payload idempotency key.',
            requestId: request.id,
          },
        });
        return;
      }

      if (!isCheckoutRequest(item.payload)) {
        response.status(400).json({
          error: { code: 'SYNC_PAYLOAD_INVALID', message: 'The order_transaction payload is invalid.', requestId: request.id },
        });
        return;
      }

      const hasDiscount = (item.payload.orderDiscountBps !== undefined && item.payload.orderDiscountBps > 0) || item.payload.items.some((line) => line.discountBps > 0);
      if (hasDiscount) {
        const authorizer = request.app.locals.prodxAuthorize as AuthorizeRequest | undefined;
        if (!authorizer || !(await authorizer(context, 'pos.discount'))) {
          response.status(403).json({ error: { code: 'DISCOUNT_NOT_AUTHORIZED', message: 'The authenticated user is not authorized to apply discounts.', requestId: request.id } });
          return;
        }
      }

      const result = await checkout.checkout({
        ...item.payload,
        idempotencyKey: item.idempotencyKey,
        storeId: context.principal.storeId,
        cashierId: context.principal.userId,
      });

      response.status(result.idempotencyCached ? 200 : 201).json({
        confirmedOrder: result.order,
        syncedAt: result.order.serverCommittedAt,
        serverConfirmed: result.serverConfirmed,
        idempotencyCached: result.idempotencyCached ?? false,
      });
    } catch (error) {
      if (error instanceof CheckoutValidationError) {
        response.status(400).json({ error: { code: error.code, message: error.message, requestId: request.id } });
        return;
      }
      if (error instanceof CheckoutConflictError) {
        response.status(409).json({ error: { code: error.code, message: error.message, requestId: request.id } });
        return;
      }
      throw error;
    }
  });
};
