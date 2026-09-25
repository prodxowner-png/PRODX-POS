[Reading 15 lines from start (total: 15 lines, 0 remaining)]

/**
 * Authentication adapter selection.
 *
 * Mock authentication is allowed only in Vite development mode.
 * Production builds always use the network adapter and fail closed
 * when its backend configuration is missing.
 */
import { IAuthApi } from './types';
import { productionAuthApi } from './authApi';
import { authApi as mockAuthApi } from './mockAdapter';

export const authApi: IAuthApi =
  import.meta.env.DEV
    ? mockAuthApi
    : productionAuthApi;

[executed on device: cs-66110132733-default (42795147-9ac6-4409-8625-90b0742cdd82)]