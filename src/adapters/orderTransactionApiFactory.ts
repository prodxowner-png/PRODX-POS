import { orderApi as mockOrderApi } from './mockAdapter';
import { createProductionOrderTransactionApi } from './productionOrderTransactionApi';
import { createProductionOrderApi } from './productionOrderApi';

export function createOrderTransactionApi(token: string) {
  if (import.meta.env.DEV) return mockOrderApi;
  return { ...createProductionOrderTransactionApi(token), ...createProductionOrderApi(token) };
}
