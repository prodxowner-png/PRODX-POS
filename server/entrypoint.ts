import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { QueryResultRow } from 'pg';
import { createPostgresAuthentication } from './auth/composition.ts';
import { createPostgresFirstTenantBootstrapRepository } from './auth/postgres-repository.ts';
import { readFirstTenantBootstrapConfig } from './auth/first-tenant-bootstrap.ts';
import type { PasswordCompromiseCheck } from './auth/password-compromise.ts';
import { createPostgresAuthorization } from './auth/production-authorization.ts';
import { asSqlExecutor, createProductionPostgresPool } from './db/postgres.ts';
import { assertPostgresReady } from './db/postgres-readiness.ts';
import { createTransactionalPostgresExecutor } from './db/transaction.ts';
import { createAIGatewayService } from './ai/production-composition.ts';
import { registerCheckoutRoute } from './http/checkout-route.ts';
import { registerAuthRoutes } from './http/auth-route.ts';
import { createApp } from './http/createApp.ts';
import { registerRefundRoute } from './http/refund-route.ts';
import { registerAuditRoute } from './http/audit-route.ts';
import { registerTasksRoute } from './http/tasks-route.ts';
import { registerShiftRoute } from './http/shift-route.ts';
import { registerTimeclockRoute } from './http/timeclock-route.ts';
import { registerCatalogRoute } from './http/catalog-route.ts';
import { registerCatalogImportRoute } from './http/catalog-import-route.ts';
import { registerCatalogPricingRoute } from './http/catalog-pricing-route.ts';
import { registerPaymentLifecycleRoute } from './http/payment-lifecycle-route.ts';
import { registerSyncRoute } from './http/sync-route.ts';
import { registerSupervisorAuthorizationRoute } from './http/supervisor-authorization-route.ts';
import { registerOrderReadRoute } from './http/order-read-route.ts';
import { registerVoidRoute } from './http/void-route.ts';
import { registerInventoryAdjustmentRoute } from './http/inventory-adjustment-route.ts';
import { registerInfrastructureRoutes, registerPublicInfrastructureRoutes } from './http/infrastructureRoutes.ts';
import { installAIHttpRoute } from './ai/http-route.ts';
export { createRetryableInitialization } from './http/retryable-initialization.ts';

export type ProductionAppOptions = {
  vercelOidcToken?: string;
  checkCompromisedPassword?: (password: string) => Promise<PasswordCompromiseCheck>;
};

export const createProductionApp = async (options: ProductionAppOptions = {}) => {
  const pool = await createProductionPostgresPool({}, options.vercelOidcToken);
  const sql = asSqlExecutor(pool);
  const transactions = createTransactionalPostgresExecutor(pool);
  // Authentication bootstrap remains a separate pre-principal boundary. All
  // post-auth authorization and AI data queries use the request-scoped executor.
  const requestScopedSql = {
    async query<T extends Record<string, unknown>>(statement: string, parameters: readonly unknown[] = []): Promise<readonly T[]> {
      const result = await transactions.query<T & QueryResultRow>(statement, parameters);
      return result.rows;
    },
  };
  const sessions = createPostgresAuthentication(sql, options.checkCompromisedPassword);
  const authorize = createPostgresAuthorization(requestScopedSql);
  const aiGateway = createAIGatewayService(requestScopedSql, authorize);

  const app = createApp({
    readinessCheck: async () => {
      // PostgreSQL is the authoritative transactional store for POS readiness.
      // A secondary service must never make the POS ready when PostgreSQL is unavailable.
      await assertPostgresReady(pool);
    },
    configurePublicRoutes: (configuredApp) => {
      registerAuthRoutes(configuredApp, requestScopedSql, sessions, {
        firstTenantBootstrap: {
          repository: createPostgresFirstTenantBootstrapRepository(requestScopedSql),
          config: readFirstTenantBootstrapConfig(process.env),
        },
      });
      registerPublicInfrastructureRoutes(configuredApp, pool);
    },
    authenticateRequest: async (request) => {
      const header = request.header('authorization');
      if (!header?.startsWith('Bearer ')) return null;
      return sessions.authenticateBearer(header.slice('Bearer '.length).trim());
    },
    authorizeRequest: authorize,
    configureRoutes: (configuredApp) => {
      registerAuditRoute(configuredApp, transactions);
      registerTasksRoute(configuredApp, transactions);
      registerShiftRoute(configuredApp, transactions);
      registerTimeclockRoute(configuredApp, transactions);
      registerCheckoutRoute(configuredApp, transactions);
      registerRefundRoute(configuredApp, transactions);
      registerCatalogRoute(configuredApp, transactions);
      registerCatalogImportRoute(configuredApp, transactions);
      registerCatalogPricingRoute(configuredApp, transactions);
      registerPaymentLifecycleRoute(configuredApp, transactions);
      registerSyncRoute(configuredApp, transactions);
      registerSupervisorAuthorizationRoute(configuredApp, transactions);
      registerOrderReadRoute(configuredApp, transactions);
      registerVoidRoute(configuredApp, transactions);
      registerInventoryAdjustmentRoute(configuredApp, transactions);
      registerInfrastructureRoutes(configuredApp, pool);
      const aiRouter = express.Router();
      installAIHttpRoute(aiRouter, { gateway: aiGateway });
      configuredApp.use('/api/v1/ai', aiRouter);
    },
  });

  return { app, pool };
};

export const startProductionServer = async (): Promise<void> => {
  const { app, pool } = await createProductionApp();
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
