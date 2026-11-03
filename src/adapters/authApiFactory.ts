/**
 * Production authentication uses the PRODX backend as the password verifier.
 * The backend owns credential hashing, compromised-password screening,
 * rate limiting, device/store scope and short-lived POS sessions.
 */
import type { IAuthApi } from './types';
import { createProductionAuthApi } from './productionAuthApi';
import { createSupabaseAuthApi } from './supabaseAuthApi';

const productionAuthApi: IAuthApi = createProductionAuthApi();
const supabaseAuthApi: IAuthApi = createSupabaseAuthApi();
const authProvider = import.meta.env.VITE_AUTH_PROVIDER?.trim().toLowerCase();

// Supabase Auth is opt-in until first-tenant bootstrap and identity binding are fully verified.
// Only explicit local development may load the isolated mock adapter.
if (!import.meta.env.DEV && authProvider !== 'supabase' && authProvider !== 'production') {
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

export const authApi: IAuthApi = import.meta.env.DEV
  ? createDevelopmentMockAuthApi()
  : authProvider === 'supabase'
    ? supabaseAuthApi
    : productionAuthApi;
