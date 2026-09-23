/**
 * Authentication adapter selection.
 *
 * Production authentication is authoritative in the backend. The frontend
 * mock adapter is available only when explicitly enabled for local/demo work.
 */
import { IAuthApi } from './types';
import { productionAuthApi } from './authApi';
import { authApi as mockAuthApi } from './mockAdapter';

const MOCK_APIS_ENABLED = import.meta.env.VITE_ENABLE_MOCK_APIS === 'true';

export const authApi: IAuthApi = MOCK_APIS_ENABLED ? mockAuthApi : productionAuthApi;
