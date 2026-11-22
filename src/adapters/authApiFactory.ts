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

export interface AuthApiResolutionOptions {
  isDev: boolean;
  provider?: string;
  apiBaseUrl?: string;
}

export interface AuthApiResolutionDependencies {
  developmentMockApi?: IAuthApi;
  supabaseApi?: IAuthApi;
  productionApi?: IAuthApi;
  unconfiguredApi?: IAuthApi;
}

export const UNCONFIGURED_AUTH_PROVIDER_ERROR =
  'Authentication provider must be explicitly configured for non-development builds.';

const productionAuthApi: IAuthApi = createProductionAuthApi();
const supabaseAuthApi: IAuthApi = createSupabaseAuthApi();

export const createUnconfiguredAuthApi = (): IAuthApi => {
  const failClosed = async (): Promise<never> => {
    throw new Error(UNCONFIGURED_AUTH_PROVIDER_ERROR);
  };
  return {
    login: failClosed,
    logout: failClosed,
    renewSession: failClosed,
    verifySession: failClosed,
    getStores: failClosed,
    forgotPin: failClosed,
  };
};

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

export const resolveAuthApi = (
  options: AuthApiResolutionOptions,
  deps: AuthApiResolutionDependencies = {},
): IAuthApi => {
  if (options.isDev) {
    if (deps.developmentMockApi) return deps.developmentMockApi;
    if (typeof import.meta.env !== 'undefined' && import.meta.env.DEV) {
      return createDevelopmentMockAuthApi();
    }
    return deps.unconfiguredApi ?? createUnconfiguredAuthApi();
  }

  // Validate explicit production API routing without a module-top-level throw;
  // invalid configuration resolves to the same fail-closed adapter as a missing provider.
  const apiBaseUrl = options.apiBaseUrl?.trim() ?? '';
  if (apiBaseUrl && !isProductionApiBaseUrl(apiBaseUrl)) {
    return deps.unconfiguredApi ?? createUnconfiguredAuthApi();
  }

  const authProvider = options.provider?.trim().toLowerCase();
  if (authProvider !== 'supabase' && authProvider !== 'production') {
    return deps.unconfiguredApi ?? createUnconfiguredAuthApi();
  }
  return authProvider === 'supabase'
    ? (deps.supabaseApi ?? supabaseAuthApi)
    : (deps.productionApi ?? productionAuthApi);
};

const useDevelopmentMock = shouldReadMock();
const runtimeEnvironment = typeof import.meta.env !== 'undefined' ? import.meta.env : undefined;

export const authApi: IAuthApi =
  typeof import.meta.env !== 'undefined' && import.meta.env.DEV
    ? createDevelopmentMockAuthApi()
    : useDevelopmentMock
      ? createDevelopmentMockAuthApi()
      : resolveAuthApi({
          isDev: false,
          provider: runtimeEnvironment?.VITE_AUTH_PROVIDER,
          apiBaseUrl: runtimeEnvironment?.VITE_AUTH_API_BASE_URL,
        });
