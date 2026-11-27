import crypto from 'node:crypto';
import type { SqlExecutor } from '../auth/postgres-repository';
import { AIGatewayService, type AIAuthorizer, type AIAuditEvent, type AIAuditor, type AIScope } from './gateway';
import { createAIProviderRegistry } from './core';
import { VercelGatewayProvider } from './vercelGatewayProvider';
import type { RequestContext } from '../http/types';

export const createAIGatewayService = (
  db: SqlExecutor,
  authorizeRequest: (context: RequestContext, permission: string) => Promise<boolean>,
): AIGatewayService => {
  const provider = new VercelGatewayProvider();
  const registry = createAIProviderRegistry([provider], 'vercel-ai-gateway');

  const authorizer: AIAuthorizer = {
    authorize: (scope: AIScope, permission: string) =>
      authorizeRequest({
        requestId: `ai-gateway-${crypto.randomUUID()}`,
        principal: {
          userId: scope.userId,
          organizationId: scope.organizationId,
          storeId: scope.storeId,
        },
      }, permission),
  };

  const auditor: AIAuditor = {
    record: async (event: AIAuditEvent) => {
      await db.query(
        `INSERT INTO prodx_audit_log
          (id, organization_id, store_id, register_id, user_id, action, severity, details)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, $7::jsonb)`,
        [
          crypto.randomUUID(),
          event.organizationId,
          event.storeId,
          event.userId,
          'ai_chat',
          event.allowed ? 'info' : 'warn',
          JSON.stringify({
            requestId: event.requestId,
            provider: event.provider,
            model: event.model ?? null,
            inputChars: event.inputChars,
            estimatedInputTokens: event.estimatedInputTokens,
            outputTokens: event.outputTokens ?? null,
            allowed: event.allowed,
            reason: event.reason ?? null,
          }),
        ],
      );
    },
  };

  return new AIGatewayService(registry, authorizer, auditor, {
    permission: 'ai:use',
    maxRequestChars: 40_000,
    maxOutputTokens: 2_000,
    maxEstimatedInputTokens: 10_000,
  });
};
