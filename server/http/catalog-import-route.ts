import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { requirePermission } from './createApp';
import type { TransactionalSqlExecutor } from '../db/transaction';

type Mode = 'upsert' | 'update_only' | 'stock_override' | 'stock_replenish';
type ProductRow = {
  id: string; store_id: string; sku: string; barcode: string; name: string; category_id: string;
  price_amount: string; cost_price_amount: string; currency: string; tax_rate_bps: number;
  current_stock: number; reorder_point: number; unit_of_measure: string;
};
type LedgerRow = {
  id: string; store_id: string; product_id: string; quantity_delta: number;
  resulting_stock: number; reason: string; reference_id: string; performed_by_user_id: string; created_at: string;
};

const dbCents = (value: unknown): number => {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value ?? '').trim());
  if (!match) throw new Error(`Invalid database monetary value: ${String(value)}`);
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Database monetary value exceeds safe integer range');
  return Number(cents);
};
const toDecimal = (cents: number): string => {
  const abs = BigInt(Math.trunc(Math.abs(cents)));
  const sign = cents < 0 ? '-' : '';
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
};
const productDto = (row: ProductRow) => ({
  id: row.id, storeId: row.store_id, sku: row.sku, barcode: row.barcode, name: row.name, categoryId: row.category_id,
  price: { amountInCents: dbCents(row.price_amount), currency: row.currency },
  costPrice: { amountInCents: dbCents(row.cost_price_amount), currency: row.currency },
  taxRateBps: row.tax_rate_bps, currentStock: row.current_stock, reorderPoint: row.reorder_point, unitOfMeasure: row.unit_of_measure,
});
const ledgerDto = (row: LedgerRow) => ({
  id: row.id, storeId: row.store_id, productId: row.product_id, quantityDelta: row.quantity_delta,
  resultingStock: row.resulting_stock, reason: row.reason, referenceId: row.reference_id,
  performedByUserId: row.performed_by_user_id, timestamp: row.created_at,
});
const hashPayload = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const slugify = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'general';

export const registerCatalogImportRoute = (app: Express, db: TransactionalSqlExecutor): void => {
  app.post('/api/v1/catalog/import', requirePermission('catalog.write'), async (request: Request, response: Response) => {
    const context = request.prodxContext;
    if (!context) { response.status(500).json({ error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.', requestId: request.id } }); return; }

    const body = request.body as { items?: unknown; mode?: unknown; idempotencyKey?: unknown; notes?: unknown };
    const items = Array.isArray(body.items) ? body.items : [];
    const mode = body.mode as Mode;
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    const notes = typeof body.notes === 'string' ? body.notes.trim() : undefined;
    if (items.length === 0 || items.length > 500) { response.status(400).json({ error: { code: 'INVALID_IMPORT_ITEMS', message: 'Between 1 and 500 import items are required.', requestId: request.id } }); return; }
    if (!['upsert', 'update_only', 'stock_override', 'stock_replenish'].includes(mode)) { response.status(400).json({ error: { code: 'INVALID_IMPORT_MODE', message: 'Invalid bulk import mode.', requestId: request.id } }); return; }
    if (!idempotencyKey) { response.status(400).json({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency key is required.', requestId: request.id } }); return; }

    const normalizedItems = items.map((item) => item && typeof item === 'object' ? item : {});
    const payloadHash = hashPayload({ items: normalizedItems, mode, notes });

    try {
      const result = await db.transaction(async (tx) => {
        const inserted = await tx.query<{ id: string }>(
          `INSERT INTO prodx_catalog_import_operations
             (id,organization_id,store_id,actor_user_id,idempotency_key,payload_hash,result)
           VALUES($1,$2,$3,$4,$5,$6,'{}'::jsonb)
           ON CONFLICT(organization_id,store_id,actor_user_id,idempotency_key) DO NOTHING RETURNING id`,
          [crypto.randomUUID(), context.principal.organizationId, context.principal.storeId, context.principal.userId, idempotencyKey, payloadHash],
        );
        if (!inserted.rows[0]) {
          const existing = await tx.query<{ payload_hash: string; result: unknown }>(
            `SELECT payload_hash,result FROM prodx_catalog_import_operations
              WHERE organization_id=$1 AND store_id=$2 AND actor_user_id=$3 AND idempotency_key=$4 FOR UPDATE`,
            [context.principal.organizationId, context.principal.storeId, context.principal.userId, idempotencyKey],
          );
          const row = existing.rows[0];
          if (!row || row.payload_hash !== payloadHash) throw Object.assign(new Error('Idempotency key was already used for a different catalog import.'), { statusCode: 409, code: 'CATALOG_IMPORT_CONFLICT' });
          return row.result;
        }

        const operationId = inserted.rows[0].id;
        const batchReference = `IMP-${operationId.slice(0, 8).toUpperCase()}`;
        const createdProducts: unknown[] = [];
        const updatedProducts: unknown[] = [];
        const ledgerEntries: unknown[] = [];
        const errors: Array<{ sku: string; rowNumber?: number; reason: string }> = [];

        for (let index = 0; index < normalizedItems.length; index += 1) {
          const item = normalizedItems[index] as Record<string, unknown>;
          const rowNumber = index + 2;
          const sku = typeof item.sku === 'string' ? item.sku.trim() : '';
          if (!sku) { errors.push({ sku: `Row #${rowNumber}`, rowNumber, reason: 'Missing mandatory SKU identifier.' }); continue; }

          const barcode = typeof item.barcode === 'string' ? item.barcode.trim() : '';
          const existing = (await tx.query<ProductRow>(
            `SELECT id,store_id,sku,barcode,name,category_id,price_amount::text,cost_price_amount::text,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure
               FROM prodx_products WHERE store_id=$1 AND (lower(sku)=lower($2) OR ($3 <> '' AND barcode=$3)) AND active=true LIMIT 1 FOR UPDATE`,
            [context.principal.storeId, sku, barcode],
          )).rows[0];

          if (!existing && mode === 'update_only') {
            errors.push({ sku, rowNumber, reason: `Product with SKU "${sku}" was not found in this store.` });
            continue;
          }

          let categoryId = existing?.category_id;
          const requestedCategoryId = typeof item.categoryId === 'string' ? item.categoryId.trim() : '';
          const requestedCategoryName = typeof item.categoryName === 'string' ? item.categoryName.trim() : '';
          if (requestedCategoryId) {
            const category = (await tx.query<{ id: string }>(
              'SELECT id FROM prodx_categories WHERE id=$1 AND store_id=$2 LIMIT 1',
              [requestedCategoryId, context.principal.storeId],
            )).rows[0];
            if (!category) { errors.push({ sku, rowNumber, reason: 'Category does not belong to this store.' }); continue; }
            categoryId = category.id;
          } else if (requestedCategoryName) {
            const category = (await tx.query<{ id: string }>(
              'SELECT id FROM prodx_categories WHERE store_id=$1 AND lower(name)=lower($2) LIMIT 1',
              [context.principal.storeId, requestedCategoryName],
            )).rows[0];
            if (category) categoryId = category.id;
            else {
              const createdCategoryId = crypto.randomUUID();
              await tx.query(
                `INSERT INTO prodx_categories(id,organization_id,store_id,name,slug)
                 VALUES($1,$2,$3,$4,$5)
                 ON CONFLICT(store_id,slug) DO NOTHING`,
                [createdCategoryId, context.principal.organizationId, context.principal.storeId, requestedCategoryName, slugify(requestedCategoryName)],
              );
              categoryId = (await tx.query<{ id: string }>(
                'SELECT id FROM prodx_categories WHERE store_id=$1 AND slug=$2 LIMIT 1',
                [context.principal.storeId, slugify(requestedCategoryName)],
              )).rows[0]?.id;
            }
          }

          if (!categoryId) {
            categoryId = (await tx.query<{ id: string }>(
              'SELECT id FROM prodx_categories WHERE store_id=$1 ORDER BY created_at,id LIMIT 1',
              [context.principal.storeId],
            )).rows[0]?.id;
          }
          if (!categoryId) { errors.push({ sku, rowNumber, reason: 'No catalog category is available for this store.' }); continue; }

          const requestedStock = typeof item.currentStock === 'number' && Number.isFinite(item.currentStock) ? Math.max(0, Math.trunc(item.currentStock)) : undefined;
          const requestedDelta = typeof item.quantityDelta === 'number' && Number.isFinite(item.quantityDelta) ? Math.trunc(item.quantityDelta) : undefined;
          const requestedPriceCents = typeof item.priceAmountInCents === 'number' && Number.isFinite(item.priceAmountInCents) ? Math.max(0, Math.trunc(item.priceAmountInCents)) : undefined;
          const requestedCostCents = typeof item.costPriceAmountInCents === 'number' && Number.isFinite(item.costPriceAmountInCents) ? Math.max(0, Math.trunc(item.costPriceAmountInCents)) : undefined;
          const requestedTax = typeof item.taxRateBps === 'number' && Number.isFinite(item.taxRateBps) ? Math.max(0, Math.min(10000, Math.trunc(item.taxRateBps))) : undefined;
          const requestedReorder = typeof item.reorderPoint === 'number' && Number.isFinite(item.reorderPoint) ? Math.max(0, Math.trunc(item.reorderPoint)) : undefined;
          const requestedName = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : undefined;
          const requestedUnit = typeof item.unitOfMeasure === 'string' && item.unitOfMeasure.trim() ? item.unitOfMeasure.trim() : undefined;

          if (existing) {
            let nextStock = existing.current_stock;
            let delta = 0;
            let reason = 'audit_count_adjustment';
            if (mode === 'stock_override') {
              if (requestedStock !== undefined) { nextStock = requestedStock; delta = nextStock - existing.current_stock; }
            } else if (mode === 'stock_replenish') {
              if (requestedDelta !== undefined) { delta = requestedDelta; nextStock = Math.max(0, existing.current_stock + delta); reason = delta > 0 ? 'purchase_received' : 'audit_count_adjustment'; }
            } else if (requestedDelta !== undefined) {
              delta = requestedDelta; nextStock = Math.max(0, existing.current_stock + delta); reason = delta > 0 ? 'purchase_received' : 'audit_count_adjustment';
            } else if (requestedStock !== undefined) {
              delta = requestedStock - existing.current_stock; nextStock = requestedStock;
            }

            await tx.query(
              `UPDATE prodx_products SET
                 name=COALESCE($3,name), barcode=CASE WHEN $4 <> '' THEN $4 ELSE barcode END, category_id=$5,
                 price_amount=COALESCE($6::numeric,price_amount), cost_price_amount=COALESCE($7::numeric,cost_price_amount),
                 tax_rate_bps=COALESCE($8,tax_rate_bps), current_stock=$9, reorder_point=COALESCE($10,reorder_point),
                 unit_of_measure=COALESCE($11,unit_of_measure), updated_at=CURRENT_TIMESTAMP
               WHERE id=$1 AND store_id=$2`,
              [existing.id, context.principal.storeId, requestedName ?? null, barcode, categoryId, requestedPriceCents !== undefined ? toDecimal(requestedPriceCents) : null, requestedCostCents !== undefined ? toDecimal(requestedCostCents) : null, requestedTax, nextStock, requestedReorder, requestedUnit],
            );
            const updated = (await tx.query<ProductRow>(
              `SELECT id,store_id,sku,barcode,name,category_id,price_amount::text,cost_price_amount::text,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure
                 FROM prodx_products WHERE id=$1 AND store_id=$2`,
              [existing.id, context.principal.storeId],
            )).rows[0];
            updatedProducts.push(productDto(updated));
            if (delta !== 0) {
              const ledger = (await tx.query<LedgerRow>(
                `INSERT INTO prodx_inventory_ledger(id,organization_id,store_id,product_id,quantity_delta,resulting_stock,reason,reference_id,performed_by_user_id)
                 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
                 RETURNING id,store_id,product_id,quantity_delta,resulting_stock,reason,reference_id,performed_by_user_id,created_at`,
                [crypto.randomUUID(), context.principal.organizationId, context.principal.storeId, existing.id, delta, nextStock, reason, operationId, context.principal.userId],
              )).rows[0];
              ledgerEntries.push(ledgerDto(ledger));
            }
          } else {
            if (!categoryId) { errors.push({ sku, rowNumber, reason: 'A category is required for new products.' }); continue; }
            const initialStock = mode === 'stock_replenish' ? Math.max(0, requestedDelta ?? 0) : Math.max(0, requestedStock ?? requestedDelta ?? 0);
            const priceCents = requestedPriceCents ?? 1000;
            const costCents = requestedCostCents ?? Number((BigInt(priceCents) * 4000n + 5000n) / 10000n);
            const newId = crypto.randomUUID();
            const finalBarcode = barcode || `IMPORT-${operationId.slice(0, 8)}-${index + 1}`;
            await tx.query(
              `INSERT INTO prodx_products
                 (id,organization_id,store_id,category_id,sku,barcode,name,price_amount,cost_price_amount,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9::numeric,'THB',$10,$11,$12,$13)`,
              [newId, context.principal.organizationId, context.principal.storeId, categoryId, sku, finalBarcode, requestedName ?? `Item ${sku}`, toDecimal(priceCents), toDecimal(costCents), requestedTax ?? 700, initialStock, requestedReorder ?? 10, requestedUnit ?? 'piece'],
            );
            const created = (await tx.query<ProductRow>(
              `SELECT id,store_id,sku,barcode,name,category_id,price_amount::text,cost_price_amount::text,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure
                 FROM prodx_products WHERE id=$1 AND store_id=$2`,
              [newId, context.principal.storeId],
            )).rows[0];
            createdProducts.push(productDto(created));
            if (initialStock > 0) {
              const ledger = (await tx.query<LedgerRow>(
                `INSERT INTO prodx_inventory_ledger(id,organization_id,store_id,product_id,quantity_delta,resulting_stock,reason,reference_id,performed_by_user_id)
                 VALUES($1,$2,$3,$4,$5,$6,'purchase_received',$7,$8)
                 RETURNING id,store_id,product_id,quantity_delta,resulting_stock,reason,reference_id,performed_by_user_id,created_at`,
                [crypto.randomUUID(), context.principal.organizationId, context.principal.storeId, newId, initialStock, initialStock, operationId, context.principal.userId],
              )).rows[0];
              ledgerEntries.push(ledgerDto(ledger));
            }
          }
        }

        const result = { batchReference, totalProcessed: normalizedItems.length, createdCount: createdProducts.length, updatedCount: updatedProducts.length, skippedCount: errors.length, createdProducts, updatedProducts, ledgerEntries, errors };
        await tx.query('UPDATE prodx_catalog_import_operations SET result=$1::jsonb WHERE id=$2', [JSON.stringify(result), operationId]);
        await tx.query(
          `INSERT INTO prodx_audit_log(id,organization_id,store_id,user_id,action,severity,details)
           VALUES($1,$2,$3,$4,'catalog_bulk_imported','info',$5::jsonb)`,
          [crypto.randomUUID(), context.principal.organizationId, context.principal.storeId, context.principal.userId, JSON.stringify({ batchReference, mode, totalItems: normalizedItems.length, createdCount: createdProducts.length, updatedCount: updatedProducts.length, skippedCount: errors.length, notes })],
        );
        return result;
      });
      response.status(200).json(result);
    } catch (error) {
      const typed = error as { statusCode?: number; code?: string; message?: string };
      if (typed.statusCode === 409) { response.status(409).json({ error: { code: typed.code ?? 'CATALOG_IMPORT_CONFLICT', message: typed.message ?? 'Catalog import conflicts with current state.', requestId: request.id } }); return; }
      throw error;
    }
  });
};
