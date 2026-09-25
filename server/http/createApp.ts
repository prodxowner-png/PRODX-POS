import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
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

      request.prodxContext = {
        requestId: request.id,
        principal,
      };
      next();
    } catch {
      sendError(response, 401, 'UNAUTHENTICATED', 'Authentication could not be verified.', request.id);
    }
  };
};

export const createApp = (options: BackendBoundaryOptions) => {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(attachRequestId);
  app.locals.prodxAuthorize = options.authorizeRequest;
  options.configurePublicRoutes?.(app);
  app.use(authenticate(options.authenticateRequest));

  app.get('/api/v1/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  options.configureRoutes?.(app);

  app.use((_request, response) => {
    sendError(response, 404, 'NOT_FOUND', 'Route not found.', response.getHeader('x-request-id')?.toString() ?? 'unknown');
  });

  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    const details = process.env.NODE_ENV === 'production'
      ? undefined
      : error instanceof Error ? error.message : error;
    sendError(response, 500, 'INTERNAL_ERROR', 'An unexpected server error occurred.', request.id, details);
  });

  return app;
};
