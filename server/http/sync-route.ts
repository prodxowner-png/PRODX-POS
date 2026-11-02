import type { Express, Request, Response } from 'express';
import type { OutboxItem } from '../../src/domain/sync';
import { createCheckoutService, CheckoutConflictError, CheckoutAuthorizationError } from '../transactions/checkout-service';
import { CheckoutValidationError, hasCheckoutDiscount, isCheckoutRequest } from '../transactions/checkout-validation';
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
  const candidate = body.item;
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new CheckoutValidationError('Sync request item is required.');
  }
  const item = candidate as Record<string, unknown>;
  if (
    typeof item.id !== 'string' || !item.id.trim() ||
    typeof item.idempotencyKey !== 'string' || !item.idempotencyKey.trim() ||
    typeof item.type !== 'string' || !['order_transaction', 'shift_movement', 'stock_adjustment'].includes(item.type) ||
    typeof item.createdAt !== 'string' || Number.isNaN(Date.parse(item.createdAt)) ||
    typeof item.attempts !== 'number' || !Number.isSafeInteger(item.attempts) || item.attempts < 0 ||
    typeof item.syncState !== 'string' || !['queued', 'syncing', 'synced', 'failed', 'conflict_requires_attention'].includes(item.syncState)
  ) {
    throw new CheckoutValidationError('Sync request item metadata is invalid.');
  }
  return { item: candidate as OutboxItem };
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

      const payloadIdempotencyKey = typeof item.payload === 'object' && item.payload !== null && !Array.isArray(item.payload)
        ? (item.payload as Record<string, unknown>).idempotencyKey
        : undefined;
      if (item.idempotencyKey !== payloadIdempotencyKey) {
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

      if (hasCheckoutDiscount(item.payload)) {
        const authorizer = request.app.locals.prodxAuthorize as AuthorizeRequest | undefined;
        if (!authorizer || !(await authorizer(context, 'pos.discount'))) {
          response.status(403).json({ error: { code: 'DISCOUNT_NOT_AUTHORIZED', message: 'The authenticated user is not authorized to apply discounts.', requestId: request.id } });
          return;
        }
      }

      const sessionId = 'sessionId' in context.principal && typeof context.principal.sessionId === 'string' ? context.principal.sessionId : null;
      if (hasCheckoutDiscount(item.payload) && !sessionId) {
        response.status(500).json({ error: { code: 'SESSION_CONTEXT_MISSING', message: 'Authenticated session context is required for discount authorization.', requestId: request.id } });
        return;
      }
      const result = await checkout.checkout({
        ...item.payload,
        idempotencyKey: item.idempotencyKey,
        storeId: context.principal.storeId,
        cashierId: context.principal.userId,
      }, sessionId ? { organizationId: context.principal.organizationId, storeId: context.principal.storeId, userId: context.principal.userId, sessionId } : undefined);

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
      if (error instanceof CheckoutAuthorizationError) {
        response.status(error.code === 'DISCOUNT_SUPERVISOR_APPROVAL_REQUIRED' ? 403 : 409).json({ error: { code: error.code, message: 'Supervisor approval is required and must match the current checkout and store policy.', requestId: request.id } });
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
