import { syncApi as mockSyncApi } from './mockAdapter';
import { createProductionSyncApi } from './productionSyncApi';
import type { ISyncApi } from './types';

const MOCK_APIS_ENABLED = import.meta.env.VITE_ENABLE_MOCK_APIS === 'true';

export function createSyncApi(token: string): ISyncApi {
  if (MOCK_APIS_ENABLED) return mockSyncApi;
  return createProductionSyncApi(token);
}
