/**
 * Production authentication uses the PRODX backend as the password verifier.
 * The backend owns credential hashing, compromised-password screening,
 * rate limiting, device/store scope and short-lived POS sessions.
 */
import type { IAuthApi } from './types';
import { createProductionAuthApi } from './productionAuthApi';
import { createSupabaseAuthApi } from './supabaseAuthApi';
import { isProductionApiBaseUrl } from './apiBaseUrl';
import { shouldReadMock } from './env';

const productionAuthApi: IAuthApi = createProductionAuthApi();
const supabaseAuthApi: IAuthApi = createSupabaseAuthApi();
const authProvider = import.meta.env.VITE_AUTH_PROVIDER?.trim().toLowerCase();
const authApiBaseUrl = import.meta.env.VITE_AUTH_API_BASE_URL?.trim() || '';
const useDevelopmentMock = shouldReadMock();

if (!import.meta.env.DEV && !useDevelopmentMock && authApiBaseUrl && !isProductionApiBaseUrl(authApiBaseUrl)) {
  throw new Error('VITE_AUTH_API_BASE_URL must be a same-origin path or an absolute HTTP(S) URL when explicitly configured.');
}

// Supabase Auth is opt-in until first-tenant bootstrap and identity binding are fully verified.
// Only explicit development/preview runtimes may load the isolated mock adapter.
if (!import.meta.env.DEV && !useDevelopmentMock && authProvider !== 'supabase' && authProvider !== 'production') {
  throw new Error('Authentication provider must be explicitly configured for non-development builds.');
}

const createDevelopmentMockAuthApi = (): IAuthApi => ({
  async login(request) {
    const { developmentMockAuthApi } = await import('./developmentMockAuthApi');
    return developmentMockAuthApi.login(request);
  },
  async logout(token) {
    const { developmentMockAuthApi } = await import('./developmentMockAuthApi');
    return developmentMockAuthApi.logout(token);
  },
  async renewSession(token) {
    const { developmentMockAuthApi } = await import('./developmentMockAuthApi');
    return developmentMockAuthApi.renewSession(token);
  },
  async verifySession(token) {
    const { developmentMockAuthApi } = await import('./developmentMockAuthApi');
    return developmentMockAuthApi.verifySession(token);
  },
  async getStores(orgSlug, token) {
    const { developmentMockAuthApi } = await import('./developmentMockAuthApi');
    return developmentMockAuthApi.getStores(orgSlug, token);
  },
  async forgotPin(organizationSlug, storeCode, emailOrPin, registerId) {
    const { developmentMockAuthApi } = await import('./developmentMockAuthApi');
    return developmentMockAuthApi.forgotPin(organizationSlug, storeCode, emailOrPin, registerId);
  },
});

export const authApi: IAuthApi = useDevelopmentMock
  ? createDevelopmentMockAuthApi()
  : authProvider === 'supabase'
    ? supabaseAuthApi
    : productionAuthApi;
