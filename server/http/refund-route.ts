import type { Express, Request, Response } from 'express';
import { requirePermissionOrSupervisorAuthorization } from './createApp';
import {
  createRefundService,
  RefundConflictError,
  RefundProviderUnavailableError,
  RefundValidationError,
} from '../transactions/refund-service';
import type { TransactionalSqlExecutor } from '../db/transaction';

type RefundBodyItem = { productId: string; quantity: number };

type RefundBody = {
  orderId: string;
  refundAmount: { amountInCents: number; currency: string };
  reason: string;
  refundMethod: 'cash' | 'card' | 'qr_digital';
  itemsToRestock?: readonly RefundBodyItem[];
  idempotencyKey: string;
  supervisorAuthorizationToken?: string;
};

const MAX_MONEY_CENTS = 999_999_999_999;

const isValidMoney = (value: unknown): value is { amountInCents: number; currency: string } => {
  if (typeof value !== 'object' || value === null) return false;
  const money = value as Record<string, unknown>;
  return Number.isSafeInteger(money.amountInCents) &&
    Number(money.amountInCents) > 0 && Number(money.amountInCents) <= MAX_MONEY_CENTS &&
    typeof money.currency === 'string' && /^[A-Za-z]{3}$/.test(money.currency.trim());
};

const isValidRestockItem = (value: unknown): value is RefundBodyItem => {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.productId === 'string' && item.productId.trim().length > 0 && Number.isInteger(item.quantity);
};

const isValidRestockList = (value: unknown): value is readonly RefundBodyItem[] | undefined =>
  value === undefined || (Array.isArray(value) && value.every(isValidRestockItem));

const isValidRefundBody = (value: unknown): value is RefundBody => {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.orderId === 'string' && body.orderId.trim().length > 0 &&
    isValidMoney(body.refundAmount) &&
    typeof body.reason === 'string' && body.reason.trim().length > 0 &&
    (body.refundMethod === 'cash' || body.refundMethod === 'card' || body.refundMethod === 'qr_digital') &&
    typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim().length > 0 &&
    (body.supervisorAuthorizationToken === undefined ||
      (typeof body.supervisorAuthorizationToken === 'string' && body.supervisorAuthorizationToken.trim().length > 0)) &&
    isValidRestockList(body.itemsToRestock)
  );
};

export const registerRefundRoute = (
  app: Express,
  db: TransactionalSqlExecutor,
  permission = 'pos.refund',
): void => {
  const service = createRefundService(db);

  app.post('/api/v1/orders/refund', requirePermissionOrSupervisorAuthorization(permission), async (request: Request, response: Response) => {
    try {
      const context = request.prodxContext;
      if (!context) {
        response.status(500).json({ error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.', requestId: request.id } });
        return;
      }

      const sessionId = 'sessionId' in context.principal && typeof context.principal.sessionId === 'string' ? context.principal.sessionId : null;
      if (!sessionId) {
        response.status(500).json({ error: { code: 'SESSION_CONTEXT_MISSING', message: 'Authenticated session context is required.', requestId: request.id } });
        return;
      }

      const rawBody: unknown = request.body;
      if (!isValidRefundBody(rawBody)) {
        response.status(400).json({ error: { code: 'REFUND_VALIDATION_FAILED', message: 'The refund request body is malformed.', requestId: request.id } });
        return;
      }
      const body = rawBody;
      const result = await service.refund({
        storeId: context.principal.storeId,
        orderId: body.orderId,
        refundAmount: { ...body.refundAmount, currency: body.refundAmount.currency.trim().toUpperCase() },
        reason: body.reason,
        refundMethod: body.refundMethod,
        authorizedByUserId: context.principal.userId,
        requesterUserId: context.principal.userId,
        requesterSessionId: sessionId,
        supervisorAuthorizationToken: body.supervisorAuthorizationToken,
        itemsToRestock: body.itemsToRestock,
        idempotencyKey: body.idempotencyKey,
      });
      response.status(result.idempotencyCached ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof RefundValidationError) {
        response.status(400).json({ error: { code: error.code, message: error.message, requestId: request.id } });
        return;
      }
      if (error instanceof RefundConflictError) {
        response.status(409).json({ error: { code: error.code, message: error.message, requestId: request.id } });
        return;
      }
      if (error instanceof RefundProviderUnavailableError) {
        response.status(503).json({ error: { code: error.code, message: error.message, requestId: request.id } });
        return;
      }
      throw error;
    }
  });
};
