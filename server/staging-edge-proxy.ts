import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const MAX_BODY_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 15_000;
const ALLOWED_PATHS = new Set([
  '/api/v1/pos/sync-batch',
  '/api/v1/pos/receipt-status',
  '/api/v1/ops/terminal-sync-diagnostics',
]);

export interface StagingEdgeProxyEnv {
  VERCEL_ENV?: string;
  POS_STAGING_PROXY_TOKEN?: string;
  POS_STAGING_WORKER_ORIGIN?: string;
  POS_STAGING_ACCESS_TOKEN?: string;
  POS_STAGING_OPS_ACCESS_TOKEN?: string;
  POS_STAGING_MTLS_CERT_PEM?: string;
  POS_STAGING_MTLS_KEY_PEM?: string;
}

function sendJson(response: ServerResponse, status: number, code: string): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify({ error: code }));
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function getRoute(request: IncomingMessage): { path: string; query: string } | null {
  const parsed = new URL(request.url ?? '/', 'https://vercel.invalid');
  const rawPath = parsed.searchParams.get('path');
  if (!rawPath || parsed.searchParams.getAll('path').length !== 1) return null;
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  if (!ALLOWED_PATHS.has(path)) return null;
  if (path === '/api/v1/pos/sync-batch' && request.method !== 'POST') return null;
  if (path === '/api/v1/pos/receipt-status' && request.method !== 'GET') return null;
  if (path === '/api/v1/pos/sync-batch' && [...parsed.searchParams.keys()].some((key) => key !== 'path')) return null;
  if (path === '/api/v1/pos/receipt-status') {
    const key = parsed.searchParams.get('idempotency_key');
    if (!key || key.length < 16 || key.length > 200 || parsed.searchParams.getAll('idempotency_key').length !== 1 ||
        [...parsed.searchParams.keys()].some((name) => !['path', 'idempotency_key'].includes(name))) return null;
    return { path, query: `?idempotency_key=${encodeURIComponent(key)}` };
  }
  if (path === '/api/v1/ops/terminal-sync-diagnostics') {
    if (request.method !== 'GET') return null;
    const terminalId = parsed.searchParams.get('terminal_id');
    if (!terminalId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(terminalId) ||
        parsed.searchParams.getAll('terminal_id').length !== 1 ||
        [...parsed.searchParams.keys()].some((name) => !['path', 'terminal_id'].includes(name))) return null;
    return { path, query: `?terminal_id=${encodeURIComponent(terminalId)}` };
  }
  return { path, query: '' };
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function createStagingEdgeProxy(env: StagingEdgeProxyEnv) {
  return async function stagingEdgeProxy(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // Preview-only: never allow the production alias or a local/development runtime to proxy Staging.
    if (env.VERCEL_ENV !== 'preview') return sendJson(response, 404, 'NOT_FOUND');

    const route = getRoute(request);
    if (!route) return sendJson(response, 404, 'NOT_FOUND');

    const configuredToken = env.POS_STAGING_PROXY_TOKEN;
    const authorization = request.headers.authorization ?? '';
    if (!configuredToken || !authorization.startsWith('Bearer ') ||
        !safeEqual(authorization.slice(7), configuredToken)) {
      return sendJson(response, 401, 'UNAUTHORIZED');
    }

    const required = [env.POS_STAGING_WORKER_ORIGIN, env.POS_STAGING_ACCESS_TOKEN, env.POS_STAGING_OPS_ACCESS_TOKEN,
      env.POS_STAGING_MTLS_CERT_PEM, env.POS_STAGING_MTLS_KEY_PEM];
    if (required.some((value) => !value?.trim())) return sendJson(response, 503, 'STAGING_PROXY_NOT_CONFIGURED');

    let origin: URL;
    try {
      origin = new URL(env.POS_STAGING_WORKER_ORIGIN!);
      if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' ||
          origin.search || origin.hash || !origin.hostname.startsWith('prodx-pos-edge-sync-staging.') ||
          !origin.hostname.endsWith('.workers.dev')) {
        return sendJson(response, 503, 'STAGING_UPSTREAM_NOT_ALLOWED');
      }
    } catch {
      return sendJson(response, 503, 'STAGING_UPSTREAM_NOT_ALLOWED');
    }

    if (request.method === 'GET' &&
        ((request.headers['content-length'] && request.headers['content-length'] !== '0') || request.headers['transfer-encoding'])) {
      return sendJson(response, 400, 'INVALID_REQUEST');
    }

    let body: Buffer;
    try {
      body = request.method === 'POST' ? await readBody(request) : Buffer.alloc(0);
    } catch (error) {
      return sendJson(response, error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400,
        error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST');
    }

    const headers: Record<string, string> = {
      accept: 'application/json',
      // Linked App Token: Access validates this upstream JWT and stamps a new
      // downstream cf-access-jwt-assertion for the Worker application's AUD.
      'cf-access-token': route.path === '/api/v1/ops/terminal-sync-diagnostics'
        ? env.POS_STAGING_OPS_ACCESS_TOKEN! : env.POS_STAGING_ACCESS_TOKEN!,
      'cache-control': 'no-store',
    };
    if (request.method === 'POST') headers['content-type'] = 'application/json';
    if (body.length) headers['content-length'] = String(body.length);
    const requestId = request.headers['x-request-id'];
    if (typeof requestId === 'string' && /^[a-zA-Z0-9._-]{1,128}$/.test(requestId)) headers['x-request-id'] = requestId;

    const options: RequestOptions = {
      protocol: 'https:',
      hostname: origin.hostname,
      port: origin.port || 443,
      method: request.method,
      path: `${route.path}${route.query}`,
      headers,
      cert: env.POS_STAGING_MTLS_CERT_PEM!,
      key: env.POS_STAGING_MTLS_KEY_PEM!,
      rejectUnauthorized: true,
      timeout: REQUEST_TIMEOUT_MS,
    };

    await new Promise<void>((resolve) => {
      const upstream = httpsRequest(options, (upstreamResponse) => {
        response.statusCode = upstreamResponse.statusCode ?? 502;
        response.setHeader('cache-control', 'no-store');
        response.setHeader('content-type', upstreamResponse.headers['content-type'] ?? 'application/json');
        response.setHeader('x-content-type-options', 'nosniff');
        upstreamResponse.pipe(response);
        upstreamResponse.on('end', resolve);
        upstreamResponse.on('error', () => {
          if (!response.headersSent) sendJson(response, 502, 'STAGING_UPSTREAM_ERROR');
          else response.destroy();
          resolve();
        });
      });
      upstream.on('timeout', () => upstream.destroy(new Error('STAGING_UPSTREAM_TIMEOUT')));
      upstream.on('error', () => {
        if (!response.headersSent) sendJson(response, 502, 'STAGING_UPSTREAM_ERROR');
        else response.destroy();
        resolve();
      });
      if (body.length) upstream.write(body);
      upstream.end();
    });
  };
}
