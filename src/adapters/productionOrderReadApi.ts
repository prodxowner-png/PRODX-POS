import type { Order } from '../domain/order';

const configuredBaseUrl = (): string | undefined => import.meta.env?.VITE_AUTH_API_BASE_URL;

const requireBaseUrl = (baseUrl?: string): string => {
  const resolved = (baseUrl ?? configuredBaseUrl())?.trim();
  if (!resolved) {
    throw new Error('Production order read API is not configured: VITE_AUTH_API_BASE_URL is missing.');
  }
  return resolved.replace(/\/$/, '');
};

const requireToken = (token: string): string => {
  const normalized = (token || '').trim();
  if (!normalized) {
    throw new Error('Authenticated session token is required to read orders.');
  }
  return normalized;
};

export interface IProductionOrderReadApi {
  getOrders(storeId: string, limit?: number, registerId?: string): Promise<readonly Order[]>;
}

export function createProductionOrderReadApi(token: string, baseUrl?: string): IProductionOrderReadApi {
  return {
    async getOrders(storeId, limit = 50, registerId?: string) {
      const normalizedToken = requireToken(token);
      const host = requireBaseUrl(baseUrl);
      let url = `${host}/api/v1/orders?storeId=${encodeURIComponent(storeId)}&limit=${encodeURIComponent(String(limit))}`;
      if (registerId && registerId.trim()) {
        url += `&registerId=${encodeURIComponent(registerId.trim())}`;
      }
      const response = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'application/json', Authorization: `Bearer ${normalizedToken}` },
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`Order read request failed (${response.status}).`);
      }
      if (!Array.isArray(body)) {
        throw new Error('Order read API returned an invalid response.');
      }
      return body as readonly Order[];
    },
  };
}

