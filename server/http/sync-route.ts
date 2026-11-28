import type { Express, Request, Response } from 'express';
import { createMoney } from '../../src/domain/money';
import type { OutboxItem } from '../../src/domain/sync';
import {
  isShiftMovementOutboxPayload,
  isStockAdjustmentOutboxPayload,
  isSupportedOfflineCommandType,
} from '../../src/domain/sync-outbox-policy';
import { createShiftService, ShiftConflictError, ShiftValidationError } from '../shift/shift-service';
import { createCheckoutService, CheckoutConflictError, CheckoutAuthorizationError } from '../transactions/checkout-service';
import { CheckoutValidationError, hasCheckoutDiscount, isCheckoutRequest } from '../transactions/checkout-validation';
import {
  createInventoryAdjustmentService,
  InventoryAdjustmentConflictError,
  InventoryAdjustmentValidationError,
} from '../transactions/inventory-adjustment-service';
import type { TransactionalSqlExecutor } from '../db/transaction';
import type { AuthorizeRequest } from './types';

type SyncCommandEnvelope = {
  item: Omit<OutboxItem, 'type'> & { type: string };
};

const extractRawCommandType = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const candidate = (body as Record<string, unknown>).item;
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return undefined;
  const rawType = (candidate as Record<string, unknown>).type;
  return typeof rawType === 'string' ? rawType : undefined;
};

const resolveRequiredPermission = (rawType: string | undefined, defaultPermission: string): string => {
  if (rawType === 'shift_movement') return 'cash.shift.movement';
  if (rawType === 'stock_adjustment') return 'inventory.adjust';
  return defaultPermission;
};

const parseBody = (value: unknown): SyncCommandEnvelope => {
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
    typeof item.type !== 'string' || !item.type.trim() ||
    typeof item.createdAt !== 'string' || Number.isNaN(Date.parse(item.createdAt)) ||
    typeof item.attempts !== 'number' || !Number.isSafeInteger(item.attempts) || item.attempts < 0 ||
    typeof item.syncState !== 'string' || !['queued', 'syncing', 'synced', 'failed', 'conflict_requires_attention', 'dead_letter'].includes(item.syncState)
  ) {
    throw new CheckoutValidationError('Sync request item metadata is invalid.');
  }
  return { item: candidate as SyncCommandEnvelope['item'] };
};

export const registerSyncRoute = (
  app: Express,
  db: TransactionalSqlExecutor,
  permission = 'pos.sell',
): void => {
  const checkout = createCheckoutService(db);
  const shiftService = createShiftService(db);
  const inventoryAdjustment = createInventoryAdjustmentService(db);

  app.post('/api/v1/sync/commands', async (request: Request, response: Response, next) => {
    try {
      const context = request.prodxContext;
      if (!context) {
        response.status(500).json({
          error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.', requestId: request.id },
        });
        return;
      }

      const requiredPermission = resolveRequiredPermission(extractRawCommandType(request.body), permission);
      const authorizer = request.app.locals.prodxAuthorize as AuthorizeRequest | undefined;
      if (!authorizer || !(await authorizer(context, requiredPermission))) {
        response.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'The authenticated user is not authorized for this action.',
            requestId: request.id,
          },
        });
        return;
      }

      const { item } = parseBody(request.body);
      if (!isSupportedOfflineCommandType(item.type)) {
        response.status(400).json({
          error: {
            code: 'SYNC_COMMAND_UNSUPPORTED',
            message: 'Unsupported outbox command type.',
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
            message: 'Outbox idempotency key must match the command payload idempotency key.',
            requestId: request.id,
          },
        });
        return;
      }

      if (item.type === 'shift_movement') {
        if (!isShiftMovementOutboxPayload(item.payload)) {
          response.status(400).json({
            error: { code: 'SYNC_PAYLOAD_INVALID', message: 'The shift_movement payload is invalid.', requestId: request.id },
          });
          return;
        }
        if (item.payload.storeId !== undefined && item.payload.storeId !== context.principal.storeId) {
          response.status(403).json({
            error: {
              code: 'FORBIDDEN',
              message: 'Outbox shift movement store does not match the authenticated store context.',
              requestId: request.id,
            },
          });
          return;
        }

        const movement = await shiftService.recordCashMovement(
          {
            organizationId: context.principal.organizationId,
            storeId: context.principal.storeId,
            userId: context.principal.userId,
          },
          item.payload.shiftId,
          item.payload.type,
          createMoney(item.payload.amount.amountInCents, item.payload.amount.currency.trim()),
          item.payload.reason,
          item.idempotencyKey,
        );
        const idempotencyCached = Boolean((movement as { idempotencyCached?: boolean }).idempotencyCached);
        response.status(idempotencyCached ? 200 : 201).json({
          commandType: 'shift_movement',
          confirmedEntityId: movement.id,
          confirmedMovement: movement,
          syncedAt: movement.timestamp,
          serverConfirmed: true,
          idempotencyCached,
        });
        return;
      }

      if (item.type === 'stock_adjustment') {
        if (!isStockAdjustmentOutboxPayload(item.payload)) {
          response.status(400).json({
            error: { code: 'SYNC_PAYLOAD_INVALID', message: 'The stock_adjustment payload is invalid.', requestId: request.id },
          });
          return;
        }
        if (item.payload.storeId !== undefined && item.payload.storeId !== context.principal.storeId) {
          response.status(403).json({
            error: {
              code: 'FORBIDDEN',
              message: 'Outbox stock adjustment store does not match the authenticated store context.',
              requestId: request.id,
            },
          });
          return;
        }

        const result = await inventoryAdjustment.adjust({
          storeId: context.principal.storeId,
          organizationId: context.principal.organizationId,
          requesterUserId: context.principal.userId,
          productIds: item.payload.productIds,
          quantityDelta: item.payload.quantityDelta,
          reason: item.payload.reason,
          notes: item.payload.notes,
          idempotencyKey: item.idempotencyKey,
        });
        const firstEntryCreatedAt = (result.entries[0] as { created_at?: string | Date } | undefined)?.created_at;
        const syncedAt = firstEntryCreatedAt ? new Date(firstEntryCreatedAt).toISOString() : new Date().toISOString();
        response.status(result.idempotencyCached ? 200 : 201).json({
          commandType: 'stock_adjustment',
          confirmedEntityId: result.adjustmentId,
          confirmedAdjustment: {
            adjustmentId: result.adjustmentId,
            entries: result.entries,
          },
          syncedAt,
          serverConfirmed: true,
          idempotencyCached: result.idempotencyCached,
        });
        return;
      }

      if (!isCheckoutRequest(item.payload)) {
        response.status(400).json({
          error: { code: 'SYNC_PAYLOAD_INVALID', message: 'The order_transaction payload is invalid.', requestId: request.id },
        });
        return;
      }

      const checkoutRequest = {
        ...item.payload,
        idempotencyKey: item.idempotencyKey,
        storeId: context.principal.storeId,
        cashierId: context.principal.userId,
      };

      if (hasCheckoutDiscount(checkoutRequest)) {
        if (!(await authorizer(context, 'pos.discount'))) {
          // A previously committed discounted sale is an acknowledgement, not a
          // new discount operation. Resolve it with the authenticated tenant,
          // store and cashier scope before denying a first-time discount.
          const replay = await checkout.resolveCommittedReplay(checkoutRequest, {
            organizationId: context.principal.organizationId,
            storeId: context.principal.storeId,
            cashierId: context.principal.userId,
          });
          if (replay) {
            response.status(200).json({
              commandType: 'order_transaction',
              confirmedEntityId: replay.order.id,
              confirmedOrder: replay.order,
              syncedAt: replay.order.serverCommittedAt,
              serverConfirmed: replay.serverConfirmed,
              idempotencyCached: true,
            });
            return;
          }
          response.status(403).json({ error: { code: 'DISCOUNT_NOT_AUTHORIZED', message: 'The authenticated user is not authorized to apply discounts.', requestId: request.id } });
          return;
        }
      }

      const sessionId = 'sessionId' in context.principal && typeof context.principal.sessionId === 'string' ? context.principal.sessionId : null;
      if (hasCheckoutDiscount(checkoutRequest) && !sessionId) {
        response.status(500).json({ error: { code: 'SESSION_CONTEXT_MISSING', message: 'Authenticated session context is required for discount authorization.', requestId: request.id } });
        return;
      }
      const result = await checkout.checkout(
        checkoutRequest,
        sessionId ? { organizationId: context.principal.organizationId, storeId: context.principal.storeId, userId: context.principal.userId, sessionId } : undefined,
      );

      response.status(result.idempotencyCached ? 200 : 201).json({
        commandType: 'order_transaction',
        confirmedEntityId: result.order.id,
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
      if (error instanceof ShiftValidationError) {
        response.status(400).json({ error: { code: error.code, message: error.message, requestId: request.id } });
        return;
      }
      if (error instanceof ShiftConflictError) {
        response.status(409).json({ error: { code: error.code, message: error.message, requestId: request.id } });
        return;
      }
      if (error instanceof InventoryAdjustmentValidationError) {
        response.status(400).json({ error: { code: error.code, message: error.message, requestId: request.id } });
        return;
      }
      if (error instanceof InventoryAdjustmentConflictError) {
        response.status(409).json({ error: { code: error.code, message: error.message, requestId: request.id } });
        return;
      }
      next(error);
    }
  });
};
