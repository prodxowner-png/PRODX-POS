import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  logger as defaultLogger,
  resolveTraceContext,
  safeErrorDiagnostic,
  type StructuredLogger,
} from '../observability/logger.ts';
import { runWithRequestContext } from './request-context-storage.ts';
import type {
  ApiErrorBody,
  AuthenticateRequest,
  AuthorizeRequest,
  RequestContext,
  RequestPrincipal,
} from './types';

declare global {
  namespace Express {
    interface Request {
      id: string;
      traceId: string;
      traceparent: string;
      prodxContext?: RequestContext;
      rawBody?: Buffer;
    }
  }
}

export type BackendBoundaryOptions = {
  authenticateRequest: AuthenticateRequest;
  authorizeRequest?: AuthorizeRequest;
  configurePublicRoutes?: (app: express.Express) => void;
  readinessCheck?: () => Promise<void>;
  configureRoutes?: (app: express.Express) => void;
  logger?: StructuredLogger;
};

const sendError = (
  response: Response,
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): void => {
  const body: ApiErrorBody = {
    error: { code, message, requestId, ...(details === undefined ? {} : { details }) },
  };
  response.status(status).json(body);
};

const requestId = (request: Request): string => {
  const supplied = request.header('x-request-id');
  return supplied && supplied.length <= 128 ? supplied : crypto.randomUUID();
};

export const requirePermission = (permission: string) => {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const context = request.prodxContext;
    if (!context) {
      sendError(response, 500, 'REQUEST_CONTEXT_MISSING', 'Request context is required.', request.id);
      return;
    }

    const authorizer = request.app.locals.prodxAuthorize as AuthorizeRequest | undefined;
    if (!authorizer) {
      sendError(response, 500, 'AUTHORIZATION_NOT_CONFIGURED', 'Authorization is not configured.', context.requestId);
      return;
    }

    if (!(await authorizer(context, permission))) {
      sendError(response, 403, 'FORBIDDEN', 'The requested capability is not authorized.', context.requestId);
      return;
    }

    next();
  };
};

const attachCorrelationAndAccessLog = (log: StructuredLogger) => {
  return (request: Request, response: Response, next: NextFunction): void => {
    const id = requestId(request);
    const trace = resolveTraceContext(request.header('traceparent'));
    request.id = id;
    request.traceId = trace.traceId;
    request.traceparent = trace.traceparent;
    response.setHeader('x-request-id', id);
    response.setHeader('traceparent', trace.traceparent);

    const startedAt = process.hrtime.bigint();
    response.on('finish', () => {
      const durationMs = Math.round((Number(process.hrtime.bigint() - startedAt) / 1_000_000) * 100) / 100;
      const status = response.statusCode;
      const fields = {
        requestId: request.id,
        traceId: request.traceId,
        method: request.method,
        path: request.path,
        status,
        durationMs,
        organizationId: request.prodxContext?.principal.organizationId,
        storeId: request.prodxContext?.principal.storeId,
      };
      if (status >= 500) {
        log.error('http.request', fields);
      } else if (status >= 400) {
        log.warn('http.request', fields);
      } else {
        log.info('http.request', fields);
      }
    });

    next();
  };
};

const authenticate = (authenticator: AuthenticateRequest) => {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const principal: RequestPrincipal | null = await authenticator(request);
      if (!principal) {
        sendError(response, 401, 'UNAUTHENTICATED', 'Authentication is required.', request.id);
        return;
      }

      const context = {
        requestId: request.id,
        principal,
      };
      request.prodxContext = context;
      runWithRequestContext(context, next);
    } catch {
      sendError(response, 401, 'UNAUTHENTICATED', 'Authentication could not be verified.', request.id);
    }
  };
};

export const createApp = (options: BackendBoundaryOptions) => {
  const app = express();
  const log = options.logger ?? defaultLogger;
  app.disable('x-powered-by');

  // Client IPs are security-sensitive input for login throttling. Only trust
  // forwarded headers when the deployment explicitly configures a trusted
  // proxy hop count; otherwise Express uses the direct socket address.
  const trustedProxy = process.env.TRUST_PROXY?.trim();
  if (trustedProxy) {
    if (/^\d+$/.test(trustedProxy)) {
      app.set('trust proxy', Number.parseInt(trustedProxy, 10));
    } else if (trustedProxy === 'true') {
      app.set('trust proxy', true);
    } else if (trustedProxy === 'false') {
      app.set('trust proxy', false);
    } else {
      throw new Error('TRUST_PROXY must be a non-negative hop count or true/false.');
    }
  }

  // Attach correlation and access logging before parsing so malformed JSON receives request & trace ids too.
  app.use(attachCorrelationAndAccessLog(log));
  app.use(express.json({
    limit: '1mb',
    verify: (request, _response, buffer) => {
      (request as Request).rawBody = Buffer.from(buffer);
    },
  }));
  app.locals.prodxAuthorize = options.authorizeRequest;
  options.configurePublicRoutes?.(app);
  app.get('/api/v1/healthz', (_request, response) => {
    response.json({ status: 'ok' });
  });
  app.get('/api/v1/readyz', async (request, response) => {
    if (!options.readinessCheck) {
      sendError(response, 503, 'READINESS_NOT_CONFIGURED', 'Readiness is not configured.', request.id);
      return;
    }

    try {
      await options.readinessCheck();
      response.json({ status: 'ready' });
    } catch (error: unknown) {
      const diagnostic = safeErrorDiagnostic(error);
      console.error('PRODX readiness check failed', {
        requestId: request.id,
        status: 503,
        ...diagnostic,
      });
      log.error('readiness.check_failed', {
        requestId: request.id,
        traceId: request.traceId,
        method: request.method,
        path: request.path,
        status: 503,
        ...diagnostic,
      });
      sendError(response, 503, 'NOT_READY', 'The service is not ready.', request.id);
    }
  });
  app.use('/api', authenticate(options.authenticateRequest));

  app.get('/api/v1/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  options.configureRoutes?.(app);

  app.use('/api', (_request, response) => {
    sendError(response, 404, 'NOT_FOUND', 'Route not found.', response.getHeader('x-request-id')?.toString() ?? 'unknown');
  });

  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    const parserError = error && typeof error === 'object'
      ? error as { type?: unknown; status?: unknown }
      : undefined;
    if (
      error instanceof SyntaxError &&
      parserError?.type === 'entity.parse.failed' &&
      parserError.status === 400
    ) {
      sendError(response, 400, 'INVALID_JSON', 'Request body must be valid JSON.', request.id);
      return;
    }

    const diagnostic = safeErrorDiagnostic(error);
    console.error('PRODX unhandled request error', {
      requestId: request.id,
      method: request.method,
      path: request.path,
      status: 500,
      ...diagnostic,
    });
    log.error('http.unhandled_error', {
      requestId: request.id,
      traceId: request.traceId,
      method: request.method,
      path: request.path,
      status: 500,
      organizationId: request.prodxContext?.principal.organizationId,
      storeId: request.prodxContext?.principal.storeId,
      ...diagnostic,
    });
    const details = process.env.NODE_ENV === 'production'
      ? undefined
      : error instanceof Error ? error.message : error;
    sendError(response, 500, 'INTERNAL_ERROR', 'An unexpected server error occurred.', request.id, details);
  });

  return app;
};
