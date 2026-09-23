import 'dotenv/config';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createPostgresAuthentication } from './auth/composition';
import { createPostgresAuthorization } from './auth/production-authorization';
import { asSqlExecutor, createPostgresPool } from './db/postgres';
import { createTransactionalPostgresExecutor } from './db/transaction';
import { registerCheckoutRoute } from './http/checkout-route';
import { createApp } from './http/createApp';
import { registerRefundRoute } from './http/refund-route';
import { registerPaymentLifecycleRoute } from './http/payment-lifecycle-route';
import { registerSyncRoute } from './http/sync-route';
import { registerSupervisorAuthorizationRoute } from './http/supervisor-authorization-route';
import { AIGatewayService, createAIProviderRegistry, GeminiProvider, installAIHttpRoute } from './ai';

export const createProductionApp = () => {
  const pool = createPostgresPool();
  const sql = asSqlExecutor(pool);
  const transactions = createTransactionalPostgresExecutor(pool);
  const sessions = createPostgresAuthentication(sql);
  const authorize = createPostgresAuthorization(sql);
  const gemini = new GeminiProvider();
  const aiRegistry = createAIProviderRegistry([gemini], 'gemini');
  const aiGateway = new AIGatewayService(
    aiRegistry,
    { authorize: (scope, permission) => authorize({ requestId: 'ai-gateway', principal: scope }, permission) },
    { record: async (event) => {
      await pool.query(
        `INSERT INTO prodx_audit_log(id,organization_id,store_id,register_id,user_id,action,severity,details)
         VALUES($1,$2,$3,NULL,$4,$5,$6,$7::jsonb)`,
        [crypto.randomUUID(), event.organizationId, event.storeId, event.userId, 'ai_chat', event.allowed ? 'info' : 'warn', JSON.stringify({ requestId: event.requestId, provider: event.provider, model: event.model ?? null, inputChars: event.inputChars, estimatedInputTokens: event.estimatedInputTokens, outputTokens: event.outputTokens ?? null, allowed: event.allowed, reason: event.reason ?? null })],
      );
    } },
    { permission: 'ai:use' },
  );

  const app = createApp({
    authenticateRequest: async (request) => {
      const header = request.header('authorization');
      if (!header?.startsWith('Bearer ')) return null;
      return sessions.authenticateBearer(header.slice('Bearer '.length).trim());
    },
    authorizeRequest: authorize,
    configureRoutes: (configuredApp) => {
      registerCheckoutRoute(configuredApp, transactions);
      registerRefundRoute(configuredApp, transactions);
      registerPaymentLifecycleRoute(configuredApp, transactions);
      registerSyncRoute(configuredApp, transactions);
      registerSupervisorAuthorizationRoute(configuredApp, transactions);
      installAIHttpRoute(configuredApp, { gateway: aiGateway });
    },
  });

  return { app, pool };
};

export const startProductionServer = async (): Promise<void> => {
  const { app, pool } = createProductionApp();
  const host = process.env.HOST ?? '0.0.0.0';
  const port = Number.parseInt(process.env.PORT ?? '4000', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port.');
  }

  const server = app.listen(port, host, () => {
    console.log(`PRODX POS backend listening on ${host}:${port}`);
  });

  const shutdown = async (signal: string) => {
    server.close(async () => {
      await pool.end();
      console.log(`PRODX POS backend stopped after ${signal}`);
    });
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await startProductionServer();
}
