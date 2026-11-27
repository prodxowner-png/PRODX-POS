import { resolveProductionApiBaseUrl } from './apiBaseUrl';
import type { Category, Product, InventoryLedgerEntry, BulkImportItem, BulkImportMode, BulkImportResult } from '../domain/catalog';
import type { ICatalogApi } from './types';
import { createProductionInventoryAdjustmentApi } from './productionInventoryAdjustmentApi';


const API_BASE_URL = import.meta.env.VITE_AUTH_API_BASE_URL;
const baseUrl = () => resolveProductionApiBaseUrl(API_BASE_URL);
const requireToken = (token: string) => {
  return (token || '').trim();
};

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T | null> {
  const host = baseUrl();
  try {
    const response = await fetch(`${host}${path}`, {
      ...init,
      credentials: 'include',
      headers: { Accept: 'application/json', Authorization: `Bearer ${requireToken(token)}`, ...(init?.headers ?? {}) },
    });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    return body as T;
  } catch {
    return null;
  }
}

export interface IProductionCatalogReadApi {
  getCategories(): Promise<readonly Category[]>;
  getProducts(categoryId?: string, search?: string): Promise<readonly Product[]>;
  getProductByBarcode(barcode: string): Promise<Product | null>;
  getInventoryLedger(productId?: string): Promise<readonly InventoryLedgerEntry[]>;
  bulkUpdatePricing(storeId: string, productIds: readonly string[], priceChangeType: 'set_amount' | 'percent_markup' | 'percent_discount', value: number, userId: string): Promise<readonly Product[]>;
  bulkImportProducts(storeId: string, items: readonly BulkImportItem[], mode: BulkImportMode, userId: string, notes?: string): Promise<BulkImportResult>;
}

export function createProductionCatalogReadApi(token: string): IProductionCatalogReadApi {
  return {
    getCategories: async () => {
      const res = await request<readonly Category[]>('/api/v1/catalog/categories', token);
      if (res && Array.isArray(res)) return res;
      throw new Error('Failed to load categories from production catalog API.');
    },
    getProducts: async (categoryId, search) => {
      const query = new URLSearchParams();
      if (categoryId) query.set('categoryId', categoryId);
      if (search) query.set('search', search);
      const res = await request<readonly Product[]>(`/api/v1/catalog/products${query.toString() ? `?${query}` : ''}`, token);
      if (res && Array.isArray(res)) return res;
      throw new Error('Failed to load products from production catalog API.');
    },
    getProductByBarcode: async barcode => {
      const res = await request<Product>(`/api/v1/catalog/products/by-barcode/${encodeURIComponent(barcode)}`, token);
      if (res) return res;
      throw new Error('Product not found or catalog API error.');
    },
    getInventoryLedger: async productId => {
      const query = productId ? `?productId=${encodeURIComponent(productId)}` : '';
      const res = await request<readonly InventoryLedgerEntry[]>(`/api/v1/catalog/inventory-ledger${query}`, token);
      if (res && Array.isArray(res)) return res;
      throw new Error('Failed to load inventory ledger from production catalog API.');
    },
    bulkImportProducts: async (storeId, items, mode, userId, notes) => {
      const res = await request<BulkImportResult>('/api/v1/catalog/import', token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, mode, notes, idempotencyKey: `catalog-import-${crypto.randomUUID()}` }) });
      if (res) return res;
      throw new Error('Bulk product import failed on production catalog API.');
    },
    bulkUpdatePricing: async (storeId, productIds, priceChangeType, value, userId) => {
      const res = await request<{ products: Product[] }>('/api/v1/catalog/pricing/bulk', token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId, productIds, priceChangeType, value, idempotencyKey: `catalog-price-${crypto.randomUUID()}` }) });
      if (res?.products) return res.products;
      throw new Error('Bulk pricing update failed on production catalog API.');
    },
  };
}

export function createProductionCatalogApi(token: string): ICatalogApi {
  const read = createProductionCatalogReadApi(token);
  const inventory = createProductionInventoryAdjustmentApi(token);
  return {
    getCategories: (_storeId) => read.getCategories(),
    getProducts: (_storeId, categoryId, search) => read.getProducts(categoryId, search),
    getProductByBarcode: (_storeId, barcode) => read.getProductByBarcode(barcode),
    getInventoryLedger: (_storeId, productId) => read.getInventoryLedger(productId),
    adjustStock: inventory.adjustStock,
    bulkAdjustStock: inventory.bulkAdjustStock,
    bulkUpdatePricing: read.bulkUpdatePricing,
    bulkImportProducts: read.bulkImportProducts,
  };
}
