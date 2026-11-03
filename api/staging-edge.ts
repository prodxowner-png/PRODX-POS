import type { IncomingMessage, ServerResponse } from 'node:http';
import { createStagingEdgeProxy } from '../server/staging-edge-proxy.js';

// Preserve the raw request stream so the proxy can enforce its own 1 MB body cap.
export const config = { api: { bodyParser: false } };

const handler = createStagingEdgeProxy(process.env);

export default async function stagingEdgeHandler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  await handler(request, response);
}
