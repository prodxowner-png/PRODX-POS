import { orderApi as mockOrderApi } from './mockAdapter';
import { createProductionOrderTransactionApi } from './productionOrderTransactionApi';

const MOCK_APIS_ENABLED = import.meta.env.VITE_ENABLE_MOCK_APIS === 'true';

export function createOrderTransactionApi(token: string) {
  if (MOCK_APIS_ENABLED) return mockOrderApi;
  return createProductionOrderTransactionApi(token);
}
