/**
 * Production authentication uses the PRODX backend as the password verifier.
 * The backend owns credential hashing, compromised-password screening,
 * rate limiting, device/store scope and short-lived POS sessions.
 */
import type { IAuthApi } from './types';
import { createProductionAuthApi } from './productionAuthApi';
import { createSupabaseAuthApi } from './supabaseAuthApi';

export interface AuthApiResolutionOptions {
  isDev: boolean;
  provider?: string;
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

// Supabase Auth is opt-in until first-tenant bootstrap and identity binding are fully verified.
// Only explicit local development may load the isolated mock adapter.
export const createUnconfiguredAuthApi = (): IAuthApi => {
  const failClosed = async (): Promise<never> => {
    throw new Error('Authentication provider must be explicitly configured for non-development builds.');
  };
  return {
    login: failClosed,
    logout: failClosed,
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
    if (deps.developmentMockApi) {
      return deps.developmentMockApi;
    }
    if (typeof import.meta.env !== 'undefined' && import.meta.env.DEV) {
      return createDevelopmentMockAuthApi();
    }
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

export const authApi: IAuthApi =
  typeof import.meta.env !== 'undefined' && import.meta.env.DEV
    ? createDevelopmentMockAuthApi()
    : resolveAuthApi({
        isDev: false,
        provider:
          typeof import.meta.env !== 'undefined'
            ? import.meta.env.VITE_AUTH_PROVIDER
            : undefined,
      });
