import type { IAuthApi, LoginRequest } from './types';
import type { SessionContext, Store } from '../domain/auth';
import { createProductionAuthApi } from './productionAuthApi';
import { getSupabasePosAuthClient } from '../lib/supabasePosAuth';

type SupabaseAuthClient = ReturnType<typeof getSupabasePosAuthClient>;
type SupabaseAuthApiDependencies = {
  getClient?: () => SupabaseAuthClient;
  fetcher?: typeof fetch;
  fallbackApi?: IAuthApi;
};

const baseUrl = () => (import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() || '').replace(/\/$/, '');
const requireToken = (token: string) => {
  const normalized = token.trim();
  if (!normalized) throw new Error('Authentication token is required.');
  return normalized;
};

const exchangeToken = async (
  token: string,
  request: LoginRequest,
  fetcher: typeof fetch,
): Promise<SessionContext> => {
  const response = await fetcher(`${baseUrl()}/auth/supabase/session`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${requireToken(token)}`,
    },
    body: JSON.stringify({
      organizationSlug: request.organizationSlug,
      storeCode: request.storeCode,
      registerId: request.registerId,
      requireAdminRole: request.requireAdminRole === true,
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? 'Supabase authentication exchange failed.');
  return body as SessionContext;
};

export const createSupabaseAuthApi = ({
  getClient = getSupabasePosAuthClient,
  fetcher = fetch,
  fallbackApi = createProductionAuthApi(),
}: SupabaseAuthApiDependencies = {}): IAuthApi => ({
  async login(request) {
    const identity = request.emailOrPin.trim();
    // PIN identities remain verified by the PostgreSQL credential path.
    if (!identity.includes('@')) return fallbackApi.login(request);

    const client = getClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: identity,
      password: request.passwordOrPin ?? '',
    });
    if (error || !data.session?.access_token) {
      throw new Error(error?.message ?? 'Supabase sign-in did not return a session.');
    }
    try {
      return await exchangeToken(data.session.access_token, request, fetcher);
    } catch (error) {
      await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
      throw error;
    }
  },

  async logout(token) {
    const response = await fetcher(`${baseUrl()}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', Authorization: `Bearer ${requireToken(token)}` },
    });
    if (!response.ok && response.status !== 401) throw new Error('Authentication logout failed.');
    try {
      const { error } = await getClient().auth.signOut({ scope: 'local' });
      if (error) throw error;
    } catch (error) {
      if (error instanceof Error && error.message.includes('POS Supabase Auth is not configured')) return;
      throw error;
    }
  },

  async renewSession(token) {
    const normalizedPosToken = requireToken(token);
    const client = getClient();
    const current = await client.auth.getSession();
    if (current.error) throw current.error;
    if (!current.data.session) return null;

    const refreshed = await client.auth.refreshSession();
    if (refreshed.error) throw refreshed.error;
    const supabaseAccessToken = refreshed.data.session?.access_token;
    if (!supabaseAccessToken) throw new Error('Supabase session refresh did not return an access token.');

    const response = await fetcher(baseUrl() + '/auth/supabase/renew', {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer ' + normalizedPosToken,
        'X-Supabase-Authorization': 'Bearer ' + requireToken(supabaseAccessToken),
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.error?.message ?? 'POS session renewal failed.');
      Object.assign(error, { status: response.status });
      throw error;
    }
    return body as SessionContext;
  },

  async verifySession(token) {
    if (!token) return null;
    const response = await fetcher(`${baseUrl()}/auth/session`, {
      credentials: 'include',
      headers: { Accept: 'application/json', Authorization: `Bearer ${requireToken(token)}` },
    });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(`Authentication API request failed (${response.status}).`);
    return response.json() as Promise<SessionContext>;
  },

  async getStores(orgSlug, token) {
    const response = await fetcher(`${baseUrl()}/organizations/${encodeURIComponent(orgSlug)}/stores`, {
      credentials: 'include',
      headers: { Accept: 'application/json', Authorization: `Bearer ${requireToken(token)}` },
    });
    if (!response.ok) throw new Error(`Authentication API request failed (${response.status}).`);
    return response.json() as Promise<readonly Store[]>;
  },

  async forgotPin(organizationSlug, storeCode, emailOrPin, registerId) {
    return fallbackApi.forgotPin(organizationSlug, storeCode, emailOrPin, registerId);
  },
});
