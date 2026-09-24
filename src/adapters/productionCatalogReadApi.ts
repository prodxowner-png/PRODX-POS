import type { Category, InventoryLedgerEntry, Product } from '../domain/catalog';

const API_BASE_URL = import.meta.env.VITE_AUTH_API_BASE_URL;

function requireBaseUrl(): string {
  if (!API_BASE_URL) throw new Error('Production catalog API is not configured: VITE_AUTH_API_BASE_URL is missing.');
  return API_BASE_URL.replace(/\/$/, '');
}

export interface IProductionCatalogReadApi {
  getCategories(storeId: string): Promise<readonly Category[]>;
  getProducts(storeId: string, categoryId?: string, search?: string): Promise<readonly Product[]>;
  getProductByBarcode(storeId: string, barcode: string): Promise<Product | null>;
  getInventoryLedger(storeId: string, productId?: string): Promise<readonly InventoryLedgerEntry[]>;
}

export function createProductionCatalogReadApi(token: string): IProductionCatalogReadApi {
  const requireToken = () => {
    if (!token.trim()) throw new Error('Authenticated session token is required for catalog access.');
    return token.trim();
  };

  const request = async <T>(path: string): Promise<T> => {
    const response = await fetch(`${requireBaseUrl()}${path}`, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${requireToken()}`,
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
  };
}
