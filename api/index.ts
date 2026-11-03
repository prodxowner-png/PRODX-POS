import type { IncomingMessage, ServerResponse } from 'node:http';
import { getVercelOidcToken } from '@vercel/oidc';
import { createProductionApp, createRetryableInitialization } from '../server-bundle.js';

// Use Vercel's supported helper so the runtime request-context token is retrieved safely and
// refreshed according to the platform lifecycle. Never read or cache the raw OIDC token directly.
const initializeProductionApp = createRetryableInitialization(async () =>
  createProductionApp({
    vercelOidcToken: await getVercelOidcToken(),
  }),
);

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const { app } = await initializeProductionApp();
    app(request as never, response as never);
  } catch {
    response.statusCode = 503;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      error: {
        code: 'NOT_READY',
        message: 'The service is not ready.',
        requestId: request.headers['x-request-id'] ?? 'unknown',
      },
    }));
  }
}
