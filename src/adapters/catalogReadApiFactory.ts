import { createProductionCatalogReadApi, type IProductionCatalogReadApi } from './productionCatalogReadApi';
import { catalogApi as mockCatalogApi } from './mockAdapter';

export function createCatalogReadApi(token: string): IProductionCatalogReadApi {
  if (import.meta.env.DEV) return mockCatalogApi;
  return createProductionCatalogReadApi(token);
}
