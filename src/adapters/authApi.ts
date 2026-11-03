/** Production authentication adapter. No mock fallback is permitted here. */
import { createProductionAuthApi } from './authApiClient';

export { createProductionAuthApi } from './authApiClient';

export const productionAuthApi = createProductionAuthApi(
  import.meta.env.VITE_AUTH_API_BASE_URL ||
    (typeof window !== 'undefined' ? window.location.origin : undefined),
);
