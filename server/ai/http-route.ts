import type { Router } from 'express';
import { requirePermission } from '../http/createApp';
import type { RequestContext } from '../http/types';
import { AIGatewayRequestValidationError, AIGatewayService } from './gateway';
import type { AIMessage, AIMessageRole } from './types';
import { GeminiProviderError } from './geminiProvider';

const DEFAULT_PERMISSION = 'ai:use';
const MAX_BODY_BYTES = 64 * 1024;
const ALLOWED_ROLES: readonly AIMessageRole[] = ['system', 'user', 'assistant'];

type AIChatBody = {
  messages: readonly AIMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
};

export type AIHttpRouteOptions = {
  readonly gateway: AIGatewayService;
  readonly permission?: string;
};

export function installAIHttpRoute(router: Router, options: AIHttpRouteOptions): void {
  const permission = options.permission ?? DEFAULT_PERMISSION;

  router.post('/chat', requirePermission(permission), async (request, response, next) => {
    try {
      const context = request.prodxContext;
      if (!context) {
        response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.', requestId: request.id } });
        return;
      }

      const body = parseBody(request.body);
      const result = await options.gateway.chat({
        requestId: request.id,
        scope: context.principal,
        permission,
        messages: body.messages,
        model: body.model,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
      });

      response.status(200).json({
        id: result.id,
        model: result.model,
        choices: result.choices,
        usage: result.usage,
        provider: result.provider,
        requestId: request.id,
      });
    } catch (error) {
      if (error instanceof AIRequestValidationError) {
        response.status(error.status).json({ error: { code: error.code, message: error.message, requestId: request.id } });
        return;
      }
      if (error instanceof GeminiProviderError) {
        const status = error.kind === 'auth' ? 502 : error.kind === 'invalid_request' ? 400 : error.kind === 'rate_limit' ? 429 : 502;
        response.status(status).json({ error: { code: `AI_${error.kind.toUpperCase()}`, message: error.message, requestId: request.id, ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }) } });
        return;
      }
      if (error instanceof AIGatewayRequestValidationError) {
        response.status(400).json({ error: { code: error.code, message: error.message, requestId: request.id } });
        return;
      }
      next(error);
    }
  });
}

function parseBody(value: unknown): AIChatBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AIRequestValidationError(400, 'INVALID_REQUEST', 'Request body must be an object.');
  }

  if (JSON.stringify(value).length > MAX_BODY_BYTES) {
    throw new AIRequestValidationError(413, 'REQUEST_TOO_LARGE', 'AI request is too large.');
  }

  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new AIRequestValidationError(400, 'INVALID_MESSAGES', 'AI request must contain at least one message.');
  }

  const messages: AIMessage[] = [];
  for (const message of body.messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new AIRequestValidationError(400, 'INVALID_MESSAGE', 'Each AI message must be an object.');
    }
    const candidate = message as Record<string, unknown>;
    if (!ALLOWED_ROLES.includes(candidate.role as AIMessageRole) || typeof candidate.content !== 'string') {
      throw new AIRequestValidationError(400, 'INVALID_MESSAGE', 'Each AI message must contain a valid role and string content.');
    }
    messages.push({ role: candidate.role as AIMessageRole, content: candidate.content });
  }

  const model = body.model === undefined ? undefined : typeof body.model === 'string' ? body.model.trim() : null;
  const temperature = body.temperature === undefined ? undefined : typeof body.temperature === 'number' ? body.temperature : null;
  const maxTokens = body.max_tokens === undefined ? undefined : typeof body.max_tokens === 'number' ? body.max_tokens : null;

  if (model === null || temperature === null || maxTokens === null) {
    throw new AIRequestValidationError(400, 'INVALID_OPTIONS', 'AI model, temperature, and max_tokens must use valid types.');
  }

  return { messages, model: model || undefined, temperature, max_tokens: maxTokens };
}

class AIRequestValidationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'AIRequestValidationError';
  }
}
