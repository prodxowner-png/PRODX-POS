import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { requirePermission } from './createApp';
import type { TransactionalSqlExecutor } from '../db/transaction';

type PriceChangeType = 'set_amount' | 'percent_markup' | 'percent_discount';
type ProductRow = { id: string; store_id: string; sku: string; barcode: string; name: string; category_id: string; price_amount: string; cost_price_amount: string; currency: string; tax_rate_bps: number; current_stock: number; reorder_point: number; unit_of_measure: string; };

const dbCents = (value: unknown): number => {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value ?? '').trim());
  if (!match) throw new Error(`Invalid database monetary value: ${String(value)}`);
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Database monetary value exceeds safe integer range');
  return Number(cents);
};

const productDto = (row: ProductRow) => ({
  id: row.id, storeId: row.store_id, sku: row.sku, barcode: row.barcode, name: row.name, categoryId: row.category_id,
  price: { amountInCents: dbCents(row.price_amount), currency: row.currency },
  costPrice: { amountInCents: dbCents(row.cost_price_amount), currency: row.currency },
  taxRateBps: row.tax_rate_bps, currentStock: row.current_stock, reorderPoint: row.reorder_point, unitOfMeasure: row.unit_of_measure,
});
const hashPayload = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const registerCatalogPricingRoute = (app: Express, db: TransactionalSqlExecutor): void => {
  app.post('/api/v1/catalog/pricing/bulk', requirePermission('catalog.write'), async (request: Request, response: Response) => {
    const context = request.prodxContext;
    if (!context) { response.status(500).json({ error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.', requestId: request.id } }); return; }
    const body = request.body as { productIds?: unknown; priceChangeType?: unknown; value?: unknown; idempotencyKey?: unknown };
    const productIds = Array.isArray(body.productIds) ? [...new Set(body.productIds.filter((value): value is string => typeof value === 'string' && !!value.trim()).map((value) => value.trim()))] : [];
    const priceChangeType = body.priceChangeType as PriceChangeType;
    const value = body.value;
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';

    if (productIds.length === 0 || productIds.length > 100 || !productIds.every((id) => /^[0-9a-f-]{36}$/i.test(id))) { response.status(400).json({ error: { code: 'INVALID_PRODUCT_IDS', message: 'Between 1 and 100 valid product IDs are required.', requestId: request.id } }); return; }
    if (!['set_amount', 'percent_markup', 'percent_discount'].includes(priceChangeType)) { response.status(400).json({ error: { code: 'INVALID_PRICE_CHANGE_TYPE', message: 'Invalid price change type.', requestId: request.id } }); return; }
    if (typeof value !== 'number' || !Number.isFinite(value)) { response.status(400).json({ error: { code: 'INVALID_PRICE_VALUE', message: 'A finite price value is required.', requestId: request.id } }); return; }
    if (priceChangeType === 'set_amount' && value < 0) { response.status(400).json({ error: { code: 'INVALID_PRICE_VALUE', message: 'Set amount cannot be negative.', requestId: request.id } }); return; }
    if (priceChangeType === 'percent_discount' && value < 0) { response.status(400).json({ error: { code: 'INVALID_PRICE_VALUE', message: 'Discount percentage cannot be negative.', requestId: request.id } }); return; }
    if (!idempotencyKey) { response.status(400).json({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency key is required.', requestId: request.id } }); return; }

    const payloadHash = hashPayload({ productIds, priceChangeType, value });
    try {
      const result = await db.transaction(async (tx) => {
        const inserted = await tx.query<{ id: string }>(
          `INSERT INTO prodx_catalog_pricing_operations (id,organization_id,store_id,actor_user_id,idempotency_key,payload_hash,result)
           VALUES($1,$2,$3,$4,$5,$6,'[]'::jsonb)
           ON CONFLICT(organization_id,store_id,actor_user_id,idempotency_key) DO NOTHING RETURNING id`,
          [crypto.randomUUID(), context.principal.organizationId, context.principal.storeId, context.principal.userId, idempotencyKey, payloadHash],
        );
        if (!inserted.rows[0]) {
          const existing = await tx.query<{ payload_hash: string; result: unknown }>(
            `SELECT payload_hash,result FROM prodx_catalog_pricing_operations
              WHERE organization_id=$1 AND store_id=$2 AND actor_user_id=$3 AND idempotency_key=$4 FOR UPDATE`,
            [context.principal.organizationId, context.principal.storeId, context.principal.userId, idempotencyKey],
          );
          const row = existing.rows[0];
          if (!row || row.payload_hash !== payloadHash) throw Object.assign(new Error('Idempotency key was already used for a different pricing operation.'), { statusCode: 409, code: 'CATALOG_PRICING_CONFLICT' });
          return { idempotencyCached: true, products: row.result };
        }

        const rows = (await tx.query<ProductRow>(
          `SELECT id,store_id,sku,barcode,name,category_id,price_amount::text,cost_price_amount::text,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure
             FROM prodx_products WHERE store_id=$1 AND id=ANY($2::uuid[]) AND active=true FOR UPDATE`,
          [context.principal.storeId, productIds],
        )).rows;
        if (rows.length !== productIds.length) throw Object.assign(new Error('One or more products are missing or inactive in this store.'), { statusCode: 409, code: 'CATALOG_PRODUCT_SCOPE_CONFLICT' });

        const expression = priceChangeType === 'set_amount'
          ? 'ROUND($3::numeric, 2)'
          : priceChangeType === 'percent_markup'
            ? 'ROUND(price_amount * (1 + $3::numeric / 100), 2)'
            : 'GREATEST(0, ROUND(price_amount * (1 - $3::numeric / 100), 2))';

        const updated = (await tx.query<ProductRow>(
          `UPDATE prodx_products SET price_amount=${expression}, updated_at=CURRENT_TIMESTAMP
            WHERE store_id=$1 AND id=ANY($2::uuid[]) AND active=true
            RETURNING id,store_id,sku,barcode,name,category_id,price_amount::text,cost_price_amount::text,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure`,
          [context.principal.storeId, productIds, value],
        )).rows;
        const products = updated.map(productDto);
        await tx.query(`UPDATE prodx_catalog_pricing_operations SET result=$1::jsonb WHERE id=$2`, [JSON.stringify(products), inserted.rows[0].id]);
        await tx.query(
          `INSERT INTO prodx_audit_log(id,organization_id,store_id,user_id,action,severity,details)
           VALUES($1,$2,$3,$4,'catalog_price_bulk_updated','info',$5::jsonb)`,
          [crypto.randomUUID(), context.principal.organizationId, context.principal.storeId, context.principal.userId, JSON.stringify({ productIds, priceChangeType, value, idempotencyKey })],
        );
        return { idempotencyCached: false, products };
      });
      response.status(result.idempotencyCached ? 200 : 201).json(result);
    } catch (error) {
      const typed = error as { statusCode?: number; code?: string; message?: string };
      if (typed.statusCode === 409) { response.status(409).json({ error: { code: typed.code ?? 'CATALOG_PRICING_CONFLICT', message: typed.message ?? 'Pricing operation conflicts with current state.', requestId: request.id } }); return; }
      throw error;
    }
  });
};
