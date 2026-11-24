import type { ISyncApi, SyncCommandResponse } from './types';
import type { OutboxItem } from '../domain/sync';

const configuredBaseUrl = (): string | undefined => import.meta.env?.VITE_AUTH_API_BASE_URL;

function requireBaseUrl(baseUrl?: string): string {
  const resolved = baseUrl ?? configuredBaseUrl();
  if (!resolved) throw new Error('Production sync API is not configured: VITE_AUTH_API_BASE_URL is missing.');
  return resolved.replace(/\/$/, '');
}

export class SyncApiError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { status?: number; code?: string; requestId?: string; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'SyncApiError';
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.retryable =
      options.retryable ??
      (options.status === undefined ||
        options.status === 408 ||
        options.status === 429 ||
        options.status >= 500);
  }
}

export function createProductionSyncApi(token: string, baseUrl?: string): ISyncApi {
  const requireToken = () => {
    if (!token.trim()) throw new Error('Authenticated session token is required for synchronization.');
    return token.trim();
  };
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${requireBaseUrl(baseUrl)}${path}`, {
      ...init, credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${requireToken()}`, ...init.headers },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const errorObj =
        body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object'
          ? (body.error as { message?: unknown; code?: unknown; requestId?: unknown })
          : null;
      const message =
        errorObj?.message !== undefined && String(errorObj.message).trim()
          ? String(errorObj.message)
          : `Synchronization request failed with HTTP ${response.status}.`;
      const code =
        errorObj?.code !== undefined && String(errorObj.code).trim()
          ? String(errorObj.code)
          : undefined;
      const requestId =
        errorObj?.requestId !== undefined && String(errorObj.requestId).trim()
          ? String(errorObj.requestId)
          : undefined;
      throw new SyncApiError(message, {
        status: response.status,
        code,
        requestId,
      });
    }
    return body as T;
  };
  return {
    async syncOutboxItem(item: OutboxItem) {
      return request<SyncCommandResponse>('/api/v1/sync/commands', { method: 'POST', body: JSON.stringify({ item }) });
    },
    async ping(clientTimestamp = Date.now()) {
      const started = performance.now();
      const body = await request<{ status: 'ok' }>('/api/v1/healthz');
      return { serverTimestamp: new Date().toISOString(), roundTripLatencyMs: Math.max(1, Math.round(performance.now() - started)), status: body.status === 'ok' ? 'ok' : 'degraded', clientTimestamp } as { serverTimestamp: string; roundTripLatencyMs: number; status: 'ok' | 'degraded' };
    },
  };
}
