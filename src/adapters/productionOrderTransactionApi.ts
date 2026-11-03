import type { CheckoutRequest, CheckoutResponse } from './types';

const configuredBaseUrl = (): string | undefined => import.meta.env?.VITE_AUTH_API_BASE_URL;

function requireBaseUrl(baseUrl?: string): string {
  const resolved = (baseUrl ?? configuredBaseUrl())?.trim();
  if (!resolved) {
    throw new Error('Production checkout API is not configured: VITE_AUTH_API_BASE_URL is missing.');
  }
  return resolved.replace(/\/$/, '');
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null) return fallback;
  const error = (body as { error?: { message?: unknown } }).error;
  return typeof error?.message === 'string' && error.message.trim() ? error.message : fallback;
}

export function createProductionOrderTransactionApi(token: string, baseUrl?: string) {
  return {
    async createOrder(request: CheckoutRequest): Promise<CheckoutResponse> {
      const normalizedToken = (token || '').trim();
      if (!normalizedToken) {
        throw new Error('Authenticated session token is required for checkout.');
      }
      const url = requireBaseUrl(baseUrl);
      const response = await fetch(`${url}/api/v1/orders/checkout`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${normalizedToken}`,
        },
        body: JSON.stringify(request),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(errorMessage(body, `Order checkout request failed (${response.status}).`));
      }
      if (!body || typeof body !== 'object') {
        throw new Error('Order checkout API returned an invalid response.');
      }
      return body as CheckoutResponse;
    },
  };
}

