import type { IAuthApi, LoginRequest } from './types';
import type { SessionContext, Store } from '../domain/auth';

const baseUrl = () => (import.meta.env.VITE_AUTH_API_BASE_URL?.trim() || '').replace(/\/$/, '');

const requireToken = (token: string) => {
  const normalized = token.trim();
  if (!normalized) throw new Error('Authentication token is required.');
  return normalized;
};

export const createProductionAuthApi = (): IAuthApi => ({
  async login(request: LoginRequest): Promise<SessionContext> {
    const response = await fetch(`${baseUrl()}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationSlug: request.organizationSlug,
        storeCode: request.storeCode,
        registerId: request.registerId,
        emailOrPin: request.emailOrPin,
        passwordOrPin: request.passwordOrPin ?? '',
        organizationContext: request.organizationContext,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body?.error?.message ?? 'Authentication failed.');
    }
    return body as SessionContext;
  },

  async logout(token: string): Promise<void> {
    const response = await fetch(`${baseUrl()}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', Authorization: `Bearer ${requireToken(token)}` },
    });
    if (!response.ok && response.status !== 401) throw new Error('Authentication logout failed.');
  },

  async verifySession(token: string): Promise<SessionContext | null> {
    if (!token) return null;
    try {
      const response = await fetch(`${baseUrl()}/auth/session`, {
        credentials: 'include',
        headers: { Accept: 'application/json', Authorization: `Bearer ${requireToken(token)}` },
      });
      if (response.status === 401) return null;
      if (!response.ok) {
        console.warn(`Authentication API session verification failed (${response.status}). Falling back to unauthenticated.`);
        return null;
      }
      return await response.json() as SessionContext;
    } catch (e) {
      console.error('Authentication API session verification error:', e);
      return null;
    }
  },

  async getStores(orgSlug: string, token: string): Promise<readonly Store[]> {
    const response = await fetch(`${baseUrl()}/organizations/${encodeURIComponent(orgSlug)}/stores`, {
      credentials: 'include',
      headers: { Accept: 'application/json', Authorization: `Bearer ${requireToken(token)}` },
    });
    if (!response.ok) throw new Error(`Authentication API request failed (${response.status}).`);
    return response.json() as Promise<readonly Store[]>;
  },
  async forgotPin(organizationSlug: string, storeCode: string, emailOrPin: string, registerId: string): Promise<void> {
    const response = await fetch(`${baseUrl()}/auth/forgot-pin`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationSlug, storeCode, emailOrPin, registerId }),
    });
    if (!response.ok) throw new Error('Failed to request PIN reset.');
  },
});
