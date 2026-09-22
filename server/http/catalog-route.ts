import type { Express, Request, Response } from 'express';
import { requirePermission } from './createApp';
import type { SqlQueryExecutor } from '../db/transaction';

type CatalogRow = { id: string; name: string; slug: string };
type ProductRow = {
  id: string; store_id: string; sku: string; barcode: string; name: string;
  category_id: string; price_amount: string; cost_price_amount: string; currency: string;
  tax_rate_bps: number; current_stock: number; reorder_point: number; unit_of_measure: string; active: boolean;
};

const moneyCents = (value: string): number => {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error('Invalid monetary value returned by database.');
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
};
const productDto = (row: ProductRow) => ({
  id: row.id, storeId: row.store_id, sku: row.sku, barcode: row.barcode, name: row.name,
  categoryId: row.category_id,
  price: { amountInCents: moneyCents(row.price_amount), currency: row.currency },
  costPrice: { amountInCents: moneyCents(row.cost_price_amount), currency: row.currency },
  taxRateBps: row.tax_rate_bps, currentStock: row.current_stock,
  reorderPoint: row.reorder_point, unitOfMeasure: row.unit_of_measure,
});

export const registerCatalogRoute = (app: Express, db: SqlQueryExecutor, permission = 'catalog.read'): void => {
  app.get('/api/v1/catalog/categories', requirePermission(permission), async (request: Request, response: Response) => {
    const context = request.prodxContext;
    if (!context) { response.status(500).json({ error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.', requestId: request.id } }); return; }
    const rows = (await db.query<CatalogRow>(
      'SELECT id,name,slug FROM prodx_categories WHERE store_id=$1 ORDER BY name,id', [context.principal.storeId])).rows;
    response.json(rows);
  });

  app.get('/api/v1/catalog/products', requirePermission(permission), async (request: Request, response: Response) => {
    const context = request.prodxContext;
    if (!context) { response.status(500).json({ error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.', requestId: request.id } }); return; }
    const categoryId = typeof request.query.categoryId === 'string' ? request.query.categoryId.trim() : '';
    const search = typeof request.query.search === 'string' ? request.query.search.trim() : '';
    const params: string[] = [context.principal.storeId];
    const conditions = ['store_id=$1','active=true'];
    if (categoryId) { params.push(categoryId); conditions.push(`category_id=$${params.length}`); }
    if (search) { params.push(`%${search}%`); conditions.push(`(name ILIKE $${params.length} OR sku ILIKE $${params.length} OR barcode ILIKE $${params.length})`); }
    const rows = (await db.query<ProductRow>(
      `SELECT id,store_id,sku,barcode,name,category_id,price_amount::text,cost_price_amount::text,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure,active
       FROM prodx_products WHERE ${conditions.join(' AND ')} ORDER BY name,id`, params)).rows;
    response.json(rows.map(productDto));
  });

  app.get('/api/v1/catalog/products/by-barcode/:barcode', requirePermission(permission), async (request: Request, response: Response) => {
    const context = request.prodxContext;
    if (!context) { response.status(500).json({ error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.', requestId: request.id } }); return; }
    const barcode = request.params.barcode.trim();
    if (!barcode) { response.status(400).json({ error: { code: 'BARCODE_REQUIRED', message: 'Barcode is required.', requestId: request.id } }); return; }
    const row = (await db.query<ProductRow>(
      `SELECT id,store_id,sku,barcode,name,category_id,price_amount::text,cost_price_amount::text,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure,active
       FROM prodx_products WHERE store_id=$1 AND barcode=$2 AND active=true LIMIT 1`, [context.principal.storeId, barcode])).rows[0];
    response.json(row ? productDto(row) : null);
  });
};
