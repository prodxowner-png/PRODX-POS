import type { SqlQueryExecutor } from '../db/transaction';

export class CatalogValidationError extends Error {
  readonly code = 'CATALOG_VALIDATION_FAILED';
}

type DbRow = Record<string, any>;

const dbMoneyToCents = (value: unknown): number => {\n  const match = /^(\\d+)\\.(\\d{2})$/.exec(String(value));\n  if (!match) throw new CatalogValidationError('Database monetary value is invalid.');\n  return Number(BigInt(match[1]) * 100n + BigInt(match[2]));\n};\n\nconst productFromRow = (row: DbRow) => ({
  id: row.id,
  storeId: row.store_id,
  sku: row.sku,
  barcode: row.barcode,
  name: row.name,
  categoryId: row.category_id,
  price: { amountInCents: dbMoneyToCents(row.price_amount), currency: row.currency },
  costPrice: { amountInCents: dbMoneyToCents(row.cost_price_amount), currency: row.currency },
  taxRateBps: row.tax_rate_bps,
  currentStock: row.current_stock,
  reorderPoint: row.reorder_point,
  unitOfMeasure: row.unit_of_measure,
});

export const createCatalogReadService = (db: SqlQueryExecutor) => ({
  async getCategories(storeId: string) {
    if (!storeId?.trim()) throw new CatalogValidationError('Store is required.');
    const result = await db.query<DbRow>(
      'SELECT id,name,slug FROM prodx_categories WHERE store_id=$1 ORDER BY name,id',
      [storeId],
    );
    return result.rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug }));
  },

  async getProducts(storeId: string, categoryId?: string, search?: string) {
    if (!storeId?.trim()) throw new CatalogValidationError('Store is required.');
    const result = await db.query<DbRow>(
      `SELECT id,store_id,sku,barcode,name,category_id,price_amount::text,cost_price_amount::text,
              currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure
         FROM prodx_products
        WHERE store_id=$1
          AND active=true
          AND ($2::uuid IS NULL OR category_id=$2)
          AND ($3::text IS NULL OR name ILIKE '%' || $3 || '%' OR sku ILIKE '%' || $3 || '%' OR barcode ILIKE '%' || $3 || '%')
        ORDER BY name,id`,
      [storeId, categoryId ?? null, search?.trim() || null],
    );
    return result.rows.map(productFromRow);
  },

  async getProductByBarcode(storeId: string, barcode: string) {
    if (!storeId?.trim() || !barcode?.trim()) throw new CatalogValidationError('Store and barcode are required.');
    const result = await db.query<DbRow>(
      `SELECT id,store_id,sku,barcode,name,category_id,price_amount::text,cost_price_amount::text,
              currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure
         FROM prodx_products
        WHERE store_id=$1 AND barcode=$2 AND active=true
        LIMIT 1`,
      [storeId, barcode.trim()],
    );
    return result.rows[0] ? productFromRow(result.rows[0]) : null;
  },

  async getInventoryLedger(storeId: string, productId?: string) {
    if (!storeId?.trim()) throw new CatalogValidationError('Store is required.');
    const result = await db.query<DbRow>(
      `SELECT id,store_id,product_id,quantity_delta,resulting_stock,reason,reference_id,
              performed_by_user_id,created_at
         FROM prodx_inventory_ledger
        WHERE store_id=$1
          AND ($2::uuid IS NULL OR product_id=$2)
        ORDER BY created_at DESC,id DESC
        LIMIT 500`,
      [storeId, productId ?? null],
    );
    return result.rows.map((row) => ({
      id: row.id,
      storeId: row.store_id,
      productId: row.product_id,
      quantityDelta: row.quantity_delta,
      resultingStock: row.resulting_stock,
      reason: row.reason,
      referenceId: row.reference_id,
      performedByUserId: row.performed_by_user_id,
      timestamp: new Date(row.created_at).toISOString(),
    }));
  },
});
