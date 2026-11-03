import type { InventoryLedgerEntry, StockMovementReason } from '../domain/catalog';

const configuredBaseUrl = (): string | undefined => import.meta.env?.VITE_AUTH_API_BASE_URL;

const requireBaseUrl = (baseUrl?: string): string => {
  const resolved = (baseUrl ?? configuredBaseUrl())?.trim();
  if (!resolved) {
    throw new Error('Production inventory adjustment API is not configured: VITE_AUTH_API_BASE_URL is missing.');
  }
  return resolved.replace(/\/$/, '');
};

const requireToken = (token: string): string => {
  const normalized = (token || '').trim();
  if (!normalized) {
    throw new Error('Authenticated session token is required for inventory adjustments.');
  }
  return normalized;
};

type ServerEntry = {
  id: string;
  store_id: string;
  product_id: string;
  quantity_delta: number;
  resulting_stock: number;
  reason: StockMovementReason;
  reference_id: string;
  performed_by_user_id: string;
  created_at: string;
};
type ServerResult = { idempotencyCached: boolean; adjustmentId: string; entries: ServerEntry[] };

const mapEntry = (e: ServerEntry): InventoryLedgerEntry => ({
  id: e.id,
  storeId: e.store_id,
  productId: e.product_id,
  quantityDelta: e.quantity_delta,
  resultingStock: e.resulting_stock,
  reason: e.reason,
  referenceId: e.reference_id,
  performedByUserId: e.performed_by_user_id,
  timestamp: e.created_at,
});

export function createProductionInventoryAdjustmentApi(token: string, baseUrl?: string) {
  return {
    adjustStock: async (
      _storeId: string,
      productId: string,
      quantityDelta: number,
      reason: StockMovementReason,
      _userId: string,
      notes?: string,
    ) => {
      const normalizedToken = requireToken(token);
      const host = requireBaseUrl(baseUrl);
      const response = await fetch(`${host}/api/v1/inventory/adjustments`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${normalizedToken}`,
        },
        body: JSON.stringify({
          productIds: [productId],
          quantityDelta,
          reason,
          notes,
          idempotencyKey: `inventory-adjust:${crypto.randomUUID()}`,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ServerResult | null;
      if (!response.ok) {
        throw new Error(`Inventory stock adjustment failed (${response.status}).`);
      }
      if (!payload?.entries?.[0]) {
        throw new Error('Inventory adjustment API returned an invalid response.');
      }
      return mapEntry(payload.entries[0]);
    },
    bulkAdjustStock: async (
      _storeId: string,
      productIds: readonly string[],
      quantityDelta: number,
      reason: StockMovementReason,
      _userId: string,
      notes?: string,
    ) => {
      const normalizedToken = requireToken(token);
      const host = requireBaseUrl(baseUrl);
      const response = await fetch(`${host}/api/v1/inventory/adjustments`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${normalizedToken}`,
        },
        body: JSON.stringify({
          productIds,
          quantityDelta,
          reason,
          notes,
          idempotencyKey: `inventory-bulk-adjust:${crypto.randomUUID()}`,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ServerResult | null;
      if (!response.ok) {
        throw new Error(`Bulk inventory stock adjustment failed (${response.status}).`);
      }
      if (!Array.isArray(payload?.entries)) {
        throw new Error('Bulk inventory adjustment API returned an invalid response.');
      }
      return payload.entries.map(mapEntry);
    },
  };
}