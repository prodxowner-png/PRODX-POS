import type { Express, Request, Response } from 'express';
import type { CheckoutRequest } from '../../src/adapters/types';
import { createCheckoutService, CheckoutConflictError, CheckoutValidationError } from '../transactions/checkout-service';
import { requirePermission } from './createApp';
import type { TransactionalSqlExecutor } from '../db/transaction';
import type { AuthorizeRequest } from './types';

const parseBody = (value: unknown): CheckoutRequest => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new CheckoutValidationError('Request body must be an object.');
  return value as CheckoutRequest;
};

export const registerCheckoutRoute = (app: Express, db: TransactionalSqlExecutor, permission = 'pos.sell'): void => {
  const service = createCheckoutService(db);
  app.post('/api/v1/orders/checkout', requirePermission(permission), async (request: Request, response: Response) => {
    try {
      const context = request.prodxContext;
      if (!context) { response.status(500).json({ error:{code:'REQUEST_CONTEXT_MISSING',message:'Request context is required.',requestId:request.id} }); return; }
      const payload = parseBody(request.body);
      if (payload.storeId !== context.principal.storeId || payload.cashierId !== context.principal.userId) {
        response.status(403).json({ error:{code:'STORE_SCOPE_VIOLATION',message:'Checkout store and cashier must match the authenticated principal.',requestId:request.id} });
        return;
      }
      const hasDiscount = payload.orderDiscountBps !== undefined && payload.orderDiscountBps > 0 || payload.items.some((item) => item.discountBps > 0);
      if (hasDiscount) {
        const authorizer = request.app.locals.prodxAuthorize as AuthorizeRequest | undefined;
        if (!authorizer || !(await authorizer(context, 'pos.discount'))) {
          response.status(403).json({ error:{code:'DISCOUNT_NOT_AUTHORIZED',message:'The authenticated user is not authorized to apply discounts.',requestId:request.id} });
          return;
        }
      }
      const result = await service.checkout(payload);
      response.status(result.idempotencyCached ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof CheckoutValidationError) { response.status(400).json({ error:{code:error.code,message:error.message,requestId:request.id} }); return; }
      if (error instanceof CheckoutConflictError) { response.status(409).json({ error:{code:error.code,message:error.message,requestId:request.id} }); return; }
      throw error;
    }
  });
};
