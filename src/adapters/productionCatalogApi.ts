import type { ICatalogApi } from './types';
import type { BulkImportItem, BulkImportMode, BatchPriceAdjustmentParams, BatchPriceAdjustmentResult, Category, InventoryLedgerEntry, Product, StockMovementReason, BulkImportResult } from '../domain/catalog';

const API_BASE_URL = import.meta.env.VITE_AUTH_API_BASE_URL;

const baseUrl = () => {
  if (!API_BASE_URL) throw new Error('Production catalog API is not configured: VITE_AUTH_API_BASE_URL is missing.');
  return API_BASE_URL.replace(/\/$/, '');
};

const operationKey = (key?: string) => key?.trim() || crypto.randomUUID();

export function createProductionCatalogApi(token: string): ICatalogApi {
  const requireToken = () => {
    if (!token.trim()) throw new Error('Authenticated session token is required for catalog access.');
    return token.trim();
  };

  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${requireToken()}`,
        ...(init?.headers ?? {}),
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'error' in body
        ? String((body as { error?: { message?: unknown } }).error?.message ?? 'Catalog request failed.')
        : 'Catalog request failed.';
      throw new Error(message);
    }
    return body as T;
  };

  const mapProduct = (product: any): Product => ({
    ...product,
    price: { amountInCents: Number(product.price.amountInCents), currency: product.price.currency },
    costPrice: { amountInCents: Number(product.costPrice.amountInCents), currency: product.costPrice.currency },
  });

  return {
    getCategories: (storeId) => request<readonly Category[]>(`/api/v1/catalog/categories?storeId=${encodeURIComponent(storeId)}`),
    getProducts: async (storeId, categoryId, search) => {
      const params = new URLSearchParams({ storeId });
      if (categoryId) params.set('categoryId', categoryId);
      if (search) params.set('search', search);
      const rows = await request<readonly any[]>(`/api/v1/catalog/products?${params.toString()}`);
      return rows.map(mapProduct);
    },
    getProductByBarcode: async (storeId, barcode) => {
      const product = await request<any>(`/api/v1/catalog/products/barcode/${encodeURIComponent(barcode)}?storeId=${encodeURIComponent(storeId)}`);
      return product ? mapProduct(product) : null;
    },
    getInventoryLedger: (storeId, productId) => {
      const suffix = productId ? `?productId=${encodeURIComponent(productId)}` : '';
      return request<readonly InventoryLedgerEntry[]>(`/api/v1/catalog/inventory-ledger${suffix}`);
    },
    adjustStock: (storeId, productId, quantityDelta, reason, _userId, _notes, idempotencyKey) =>
      request<InventoryLedgerEntry>('/api/v1/inventory/adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, quantityDelta, reason, idempotencyKey: operationKey(idempotencyKey), storeId }),
      }),
    bulkAdjustStock: (storeId, productIds, quantityDelta, reason, _userId, _notes, idempotencyKey) =>
      request<readonly InventoryLedgerEntry[]>('/api/v1/inventory/adjustments/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds, quantityDelta, reason, idempotencyKey: operationKey(idempotencyKey), storeId }),
      }),
    async bulkUpdatePricing() { throw new Error('Production bulk pricing API is not implemented yet.'); },
    async batchPriceAdjustment(_params: BatchPriceAdjustmentParams): Promise<BatchPriceAdjustmentResult> { throw new Error('Production batch pricing API is not implemented yet.'); },
    async bulkImportProducts(_storeId: string, _items: readonly BulkImportItem[], _mode: BulkImportMode, _userId: string, _notes?: string): Promise<BulkImportResult> { throw new Error('Production bulk import API is not implemented yet.'); },
  };
}
