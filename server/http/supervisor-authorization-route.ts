import type { Express, Request, Response } from 'express';
import {
  createSupervisorAuthorizationService,
  SupervisorAuthorizationError,
} from '../auth/supervisor-authorization';
import type { TransactionalSqlExecutor } from '../db/transaction';

type Body = {
  action: 'refund' | 'void';
  orderId: string;
  supervisorUsername?: string;
  supervisorUserId?: string;
  supervisorSecret: string;
};

const valid = (value: unknown): value is Body => {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return (body.action === 'refund' || body.action === 'void') &&
    typeof body.orderId === 'string' && body.orderId.trim().length > 0 &&
    (typeof body.supervisorUsername === 'string' || typeof body.supervisorUserId === 'string') &&
    typeof body.supervisorSecret === 'string' && body.supervisorSecret.length > 0;
};

export const registerSupervisorAuthorizationRoute = (app: Express, db: TransactionalSqlExecutor): void => {
  app.post('/api/v1/authorizations/supervisor', async (request: Request, response: Response) => {
    const context = request.prodxContext;
    if (!context) {
      response.status(500).json({ error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.' } });
      return;
    }
    const authorizer = request.app.locals.prodxAuthorize as ((ctx: typeof context, permission: string) => Promise<boolean>) | undefined;
    const action = request.body?.action;
    if (!authorizer || (action !== 'refund' && action !== 'void') || !(await authorizer(context, action === 'void' ? 'pos.void' : 'pos.refund'))) {
      response.status(403).json({ error: { code: 'FORBIDDEN', message: 'The requested supervisor authorization capability is not authorized.' } });
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

    const outcome = await db.transaction(async (tx) => {
      try {
        const result = await createSupervisorAuthorizationService({
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
          supervisorUserId: request.body.supervisorUserId,
          supervisorSecret: request.body.supervisorSecret,
        });
        return { ok: true as const, result };
      } catch (error) {
        if (error instanceof SupervisorAuthorizationError) {
          return { ok: false as const, error };
        }
        throw error;
      }
    });

    if (!outcome.ok) {
      const status = outcome.error.code === 'SUPERVISOR_NOT_ALLOWED' ? 403 : 401;
      response.status(status).json({ error: { code: outcome.error.code, message: 'Supervisor authorization was not granted.' } });
      return;
    }

    response.status(201).json(outcome.result);
  });
};
