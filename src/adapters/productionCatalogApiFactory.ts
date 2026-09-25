import { createProductionCatalogApi } from './productionCatalogApi';
import type { ICatalogApi } from './types';

export function createCatalogApi(token: string): ICatalogApi {
  return createProductionCatalogApi(token);
}
