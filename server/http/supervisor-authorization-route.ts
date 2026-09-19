import type { Express, Request, Response } from 'express';
import { requirePermission } from './createApp';
import {
  createSupervisorAuthorizationService,
  SupervisorAuthorizationError,
} from '../auth/supervisor-authorization';
import type { TransactionalSqlExecutor } from '../db/transaction';

type Body = {
  action: 'refund';
  orderId: string;
  supervisorUsername: string;
  supervisorSecret: string;
};

const valid = (value: unknown): value is Body => {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return body.action === 'refund' &&
    typeof body.orderId === 'string' && body.orderId.trim().length > 0 &&
    typeof body.supervisorUsername === 'string' && body.supervisorUsername.trim().length > 0 &&
    typeof body.supervisorSecret === 'string' && body.supervisorSecret.length > 0;
};

export const registerSupervisorAuthorizationRoute = (app: Express, db: TransactionalSqlExecutor): void => {
  app.post('/api/v1/authorizations/supervisor', requirePermission('pos.refund'), async (request: Request, response: Response) => {
    const context = request.prodxContext;
    if (!context) {
      response.status(500).json({ error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.' } });
      return;
    }

    const sessionId = 'sessionId' in context.principal && typeof context.principal.sessionId === 'string' ? context.principal.sessionId : null;
    if (!sessionId) {
      response.status(500).json({ error: { code: 'SESSION_CONTEXT_MISSING', message: 'Authenticated session context is required.' } });
      return;
    }

    if (!valid(request.body)) {
      response.status(400).json({ error: { code: 'SUPERVISOR_AUTH_VALIDATION_FAILED', message: 'Malformed supervisor authorization request.' } });
      return;
    }

    try {
      const result = await db.transaction((tx) => createSupervisorAuthorizationService({
        query: async <T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) =>
          (await tx.query<T>(sql, parameters)).rows,
      }).authorize({
        organizationId: context.principal.organizationId,
        storeId: context.principal.storeId,
        requesterUserId: context.principal.userId,
        requesterSessionId: sessionId,
        action: request.body.action,
        orderId: request.body.orderId,
        supervisorUsername: request.body.supervisorUsername,
        supervisorSecret: request.body.supervisorSecret,
      }));
      response.status(201).json(result);
    } catch (error) {
      if (error instanceof SupervisorAuthorizationError) {
        const status = error.code === 'SUPERVISOR_NOT_ALLOWED' ? 403 : 401;
        response.status(status).json({ error: { code: error.code, message: 'Supervisor authorization was not granted.' } });
        return;
      }
      throw error;
    }
  });
};
