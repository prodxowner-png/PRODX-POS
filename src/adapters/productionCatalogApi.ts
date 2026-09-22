import type { Category, Product } from '../domain/catalog';

const API_BASE_URL = import.meta.env.VITE_AUTH_API_BASE_URL;

function baseUrl(): string {
  if (!API_BASE_URL) throw new Error('Production catalog API is not configured: VITE_AUTH_API_BASE_URL is missing.');
  return API_BASE_URL.replace(/\/$/, '');
}

function tokenValue(token: string): string {
  if (!token.trim()) throw new Error('Authenticated session token is required for catalog access.');
  return token.trim();
}

async function request<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json', Authorization: `Bearer ${tokenValue(token)}` },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body
      ? String((body as { error?: { message?: unknown } }).error?.message ?? 'Catalog request failed.')
      : 'Catalog request failed.';
    throw new Error(message);
  }
  return body as T;
}

export interface IProductionCatalogReadApi {
  getCategories(): Promise<readonly Category[]>;
  getProducts(categoryId?: string, search?: string): Promise<readonly Product[]>;
  getProductByBarcode(barcode: string): Promise<Product | null>;
}

export function createProductionCatalogReadApi(token: string): IProductionCatalogReadApi {
  return {
    getCategories: () => request<readonly Category[]>('/api/v1/catalog/categories', token),
    getProducts: (categoryId, search) => {
      const query = new URLSearchParams();
      if (categoryId) query.set('categoryId', categoryId);
      if (search) query.set('search', search);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return request<readonly Product[]>(`/api/v1/catalog/products${suffix}`, token);
    },
    getProductByBarcode: (barcode) =>
      request<Product | null>(`/api/v1/catalog/products/by-barcode/${encodeURIComponent(barcode)}`, token),
  };
}
