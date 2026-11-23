import { resolveProductionApiBaseUrl } from './apiBaseUrl';
import type { ISyncApi } from './types';
import type { OutboxItem } from '../domain/sync';

const configuredBaseUrl = (): string | undefined => import.meta.env?.VITE_AUTH_API_BASE_URL;

function requireBaseUrl(baseUrl?: string): string {
  return resolveProductionApiBaseUrl(baseUrl ?? configuredBaseUrl());
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
      const message = body && typeof body === 'object' && 'error' in body
        ? String((body as { error?: { message?: unknown } }).error?.message ?? 'Synchronization request failed.')
        : 'Synchronization request failed.';
      throw new Error(message);
    }
    return body as T;
  };
  return {
    async syncOutboxItem(item: OutboxItem) {
      return request<{ confirmedOrder: import('../domain/order').Order; syncedAt: string }>('/api/v1/sync/commands', { method: 'POST', body: JSON.stringify({ item }) });
    },
    async ping(clientTimestamp = Date.now()) {
      const started = performance.now();
      const body = await request<{ status: 'ok' }>('/api/v1/healthz');
      return { serverTimestamp: new Date().toISOString(), roundTripLatencyMs: Math.max(1, Math.round(performance.now() - started)), status: body.status === 'ok' ? 'ok' : 'degraded', clientTimestamp } as { serverTimestamp: string; roundTripLatencyMs: number; status: 'ok' | 'degraded' };
    },
  };
}
