import { resolveProductionApiBaseUrl } from './apiBaseUrl';
export type ProductionVoidRequest = {
  orderId: string;
  reason: string;
  idempotencyKey: string;
  supervisorAuthorizationToken: string;
};

export type ProductionVoidResponse = {
  success: true;
  orderId: string;
  status: 'voided';
  voidId: string;
  idempotencyCached: boolean;
  message: string;
};

const API_BASE_URL = resolveProductionApiBaseUrl(import.meta.env.VITE_AUTH_API_BASE_URL);

export function createProductionVoidApi(token: string) {
  return {
    async voidOrder(request: ProductionVoidRequest): Promise<ProductionVoidResponse> {
      if (!token.trim()) throw new Error('Authenticated session token is required for void.');
      const response = await fetch(API_BASE_URL.replace(/\/$/, '') + '/api/v1/orders/void', {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token.trim(),
        },
        body: JSON.stringify(request),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = body && typeof body === 'object' && 'error' in body
          ? String((body as { error?: { message?: unknown } }).error?.message ?? 'Order void failed.')
          : 'Order void failed.';
        throw new Error(message);
      }
      return body as ProductionVoidResponse;
    },
  };
}
