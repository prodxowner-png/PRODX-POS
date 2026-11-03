import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
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
      prodxContext?: RequestContext;
    }
  }
}

export type BackendBoundaryOptions = {
  authenticateRequest: AuthenticateRequest;
  authorizeRequest?: AuthorizeRequest;
  configurePublicRoutes?: (app: express.Express) => void;
  readinessCheck?: () => Promise<void>;
  configureRoutes?: (app: express.Express) => void;
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

const safeReadinessDiagnostic = (error: unknown): Record<string, string | number> => {
  const candidate = error && typeof error === 'object'
    ? error as { name?: unknown; code?: unknown; syscall?: unknown; port?: unknown; stage?: unknown }
    : {};
  const diagnostic: Record<string, string | number> = {
    name: typeof candidate.name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(candidate.name)
      ? candidate.name
      : 'unknown',
  };

  if (typeof candidate.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(candidate.code)) {
    diagnostic.code = candidate.code;
  }
  if (candidate.syscall === 'getaddrinfo' || candidate.syscall === 'connect' ||
      candidate.syscall === 'read' || candidate.syscall === 'write') {
    diagnostic.syscall = candidate.syscall;
  }
  if (typeof candidate.port === 'number' && Number.isInteger(candidate.port) &&
      candidate.port >= 1 && candidate.port <= 65535) {
    diagnostic.port = candidate.port;
  }
  if (candidate.stage === 'database_query' || candidate.stage === 'broker_fetch' ||
      candidate.stage === 'broker_http' || candidate.stage === 'broker_response') {
    diagnostic.stage = candidate.stage;
  }

  return diagnostic;
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

const attachRequestId = (request: Request, response: Response, next: NextFunction): void => {
  const id = requestId(request);
  request.id = id;
  response.setHeader('x-request-id', id);
  next();
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

  app.use(express.json({ limit: '1mb' }));
  app.use(attachRequestId);
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
      console.error('PRODX readiness check failed', {
        requestId: request.id,
        status: 503,
        ...safeReadinessDiagnostic(error),
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
    console.error('PRODX unhandled request error', {
      requestId: request.id,
      method: request.method,
      path: request.path,
      status: 500,
      ...safeReadinessDiagnostic(error),
    });
    const details = process.env.NODE_ENV === 'production'
      ? undefined
      : error instanceof Error ? error.message : error;
    sendError(response, 500, 'INTERNAL_ERROR', 'An unexpected server error occurred.', request.id, details);
  });

  return app;
};
