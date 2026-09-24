import crypto from 'node:crypto';
import type { SqlQueryExecutor, TransactionalSqlExecutor } from '../db/transaction';
import type { InventoryLedgerEntry, StockMovementReason } from '../../src/domain/catalog';

const ALLOWED_REASONS = new Set<StockMovementReason>([
  'purchase_received',
  'transfer_in',
  'transfer_out',
  'audit_count_adjustment',
  'damaged_write_off',
]);

export class InventoryAdjustmentValidationError extends Error {
  readonly code = 'INVENTORY_ADJUSTMENT_VALIDATION_FAILED';
}

export class InventoryAdjustmentConflictError extends Error {
  readonly code = 'INVENTORY_ADJUSTMENT_CONFLICT';
}

type AdjustmentContext = {
  organizationId: string;
  storeId: string;
  userId: string;
};

type LedgerRow = {
  id: string;
  store_id: string;
  product_id: string;
  quantity_delta: number;
  resulting_stock: number;
  reason: StockMovementReason;
  reference_id: string;
  performed_by_user_id: string;
  created_at: string | Date;
};

const hashPayload = (payload: unknown): string =>
  crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

const mapLedger = (row: LedgerRow): InventoryLedgerEntry => ({
  id: row.id,
  storeId: row.store_id,
  productId: row.product_id,
  quantityDelta: row.quantity_delta,
  resultingStock: row.resulting_stock,
  reason: row.reason,
  referenceId: row.reference_id,
  performedByUserId: row.performed_by_user_id,
  timestamp: new Date(row.created_at).toISOString(),
});

const validateCommon = (context: AdjustmentContext, idempotencyKey: string, reason: StockMovementReason, quantityDelta: number) => {
  if (!context.organizationId || !context.storeId || !context.userId) throw new InventoryAdjustmentValidationError('Organization, store and user are required.');
  if (!idempotencyKey.trim()) throw new InventoryAdjustmentValidationError('Idempotency key is required.');
  if (!ALLOWED_REASONS.has(reason)) throw new InventoryAdjustmentValidationError('Invalid inventory adjustment reason.');
  if (!Number.isSafeInteger(quantityDelta) || quantityDelta === 0) throw new InventoryAdjustmentValidationError('Quantity delta must be a non-zero integer.');
};

const operation = async (
  tx: SqlQueryExecutor,
  context: AdjustmentContext,
  idempotencyKey: string,
  payload: unknown,
) => {
  const payloadHash = hashPayload(payload);
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO prodx_inventory_adjustments
       (id,organization_id,store_id,performed_by_user_id,idempotency_key,payload_hash)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (store_id,idempotency_key) DO NOTHING
     RETURNING id`,
    [crypto.randomUUID(), context.organizationId, context.storeId, context.userId, idempotencyKey.trim(), payloadHash],
  );

  if (inserted.rows[0]) return { id: inserted.rows[0].id, replay: false };

  const existing = await tx.query<{ id: string; payload_hash: string }>(
    `SELECT id,payload_hash
       FROM prodx_inventory_adjustments
      WHERE store_id=$1 AND idempotency_key=$2
      FOR UPDATE`,
    [context.storeId, idempotencyKey.trim()],
  );
  const row = existing.rows[0];
  if (!row) throw new InventoryAdjustmentConflictError('Inventory adjustment idempotency record disappeared.');
  if (row.payload_hash !== payloadHash) {
    throw new InventoryAdjustmentConflictError('Idempotency key was already used for a different inventory adjustment.');
  }
  return { id: row.id, replay: true };
};

const ledgerForOperation = async (tx: SqlQueryExecutor, operationId: string): Promise<InventoryLedgerEntry[]> => {
  const result = await tx.query<LedgerRow>(
    `SELECT id,store_id,product_id,quantity_delta,resulting_stock,reason,reference_id,performed_by_user_id,created_at
       FROM prodx_inventory_ledger
      WHERE reference_id=$1
      ORDER BY id`,
    [operationId],
  );
  return result.rows.map(mapLedger);
};

export const createInventoryAdjustmentService = (db: TransactionalSqlExecutor) => ({
  async adjustStock(
    context: AdjustmentContext,
    productId: string,
    quantityDelta: number,
    reason: StockMovementReason,
    idempotencyKey: string,
  ): Promise<InventoryLedgerEntry> {
    validateCommon(context, idempotencyKey, reason, quantityDelta);
    if (!productId.trim()) throw new InventoryAdjustmentValidationError('Product is required.');

    return db.transaction(async (tx) => {
      const op = await operation(tx, context, idempotencyKey, { productId, quantityDelta, reason });
      if (op.replay) {
        const rows = await ledgerForOperation(tx, op.id);
        if (rows.length !== 1) throw new InventoryAdjustmentConflictError('Existing inventory adjustment is incomplete.');
        return rows[0];
      }

      const product = await tx.query<{ organization_id: string; current_stock: number }>(
        `SELECT organization_id,current_stock
           FROM prodx_products
          WHERE id=$1 AND store_id=$2 AND active=true
          FOR UPDATE`,
        [productId, context.storeId],
      );
      const current = product.rows[0];
      if (!current || current.organization_id !== context.organizationId) {
        throw new InventoryAdjustmentConflictError('Product is unavailable in this store.');
      }
      const resulting = Number(current.current_stock) + quantityDelta;
      if (resulting < 0) throw new InventoryAdjustmentConflictError('Inventory cannot become negative.');

      await tx.query(
        `UPDATE prodx_products
            SET current_stock=$1,updated_at=CURRENT_TIMESTAMP
          WHERE id=$2 AND store_id=$3`,
        [resulting, productId, context.storeId],
      );
      await tx.query(
        `INSERT INTO prodx_inventory_ledger
           (id,organization_id,store_id,product_id,quantity_delta,resulting_stock,reason,reference_id,performed_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [crypto.randomUUID(), context.organizationId, context.storeId, productId, quantityDelta, resulting, reason, op.id, context.userId],
      );
      await tx.query(
        `INSERT INTO prodx_audit_log
           (id,organization_id,store_id,user_id,action,severity,details)
         VALUES ($1,$2,$3,$4,'inventory_adjustment_committed','info',$5::jsonb)`,
        [crypto.randomUUID(), context.organizationId, context.storeId, context.userId, JSON.stringify({ operationId: op.id, productId, quantityDelta, reason })],
      );

      const rows = await ledgerForOperation(tx, op.id);
      if (rows.length !== 1) throw new InventoryAdjustmentConflictError('Inventory adjustment ledger write was incomplete.');
      return rows[0];
    });
  },

  async bulkAdjustStock(
    context: AdjustmentContext,
    productIds: readonly string[],
    quantityDelta: number,
    reason: StockMovementReason,
    idempotencyKey: string,
  ): Promise<readonly InventoryLedgerEntry[]> {
    validateCommon(context, idempotencyKey, reason, quantityDelta);
    const ids = [...new Set(productIds.filter(Boolean))];
    if (ids.length === 0) throw new InventoryAdjustmentValidationError('At least one product is required.');

    return db.transaction(async (tx) => {
      const op = await operation(tx, context, idempotencyKey, { productIds: ids, quantityDelta, reason });
      if (op.replay) return ledgerForOperation(tx, op.id);

      const products = await tx.query<{ id: string; organization_id: string; current_stock: number }>(
        `SELECT id,organization_id,current_stock
           FROM prodx_products
          WHERE store_id=$1 AND active=true AND id=ANY($2::uuid[])
          ORDER BY id
          FOR UPDATE`,
        [context.storeId, ids],
      );
      if (products.rows.length !== ids.length || products.rows.some((p) => p.organization_id !== context.organizationId)) {
        throw new InventoryAdjustmentConflictError('One or more products are unavailable in this store.');
      }

      for (const product of products.rows) {
        const resulting = Number(product.current_stock) + quantityDelta;
        if (resulting < 0) throw new InventoryAdjustmentConflictError(`Inventory cannot become negative for product ${product.id}.`);
        await tx.query(
          `UPDATE prodx_products SET current_stock=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND store_id=$3`,
          [resulting, product.id, context.storeId],
        );
        await tx.query(
          `INSERT INTO prodx_inventory_ledger
             (id,organization_id,store_id,product_id,quantity_delta,resulting_stock,reason,reference_id,performed_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [crypto.randomUUID(), context.organizationId, context.storeId, product.id, quantityDelta, resulting, reason, op.id, context.userId],
        );
      }

      await tx.query(
        `INSERT INTO prodx_audit_log
           (id,organization_id,store_id,user_id,action,severity,details)
         VALUES ($1,$2,$3,$4,'inventory_bulk_adjustment_committed','info',$5::jsonb)`,
        [crypto.randomUUID(), context.organizationId, context.storeId, context.userId, JSON.stringify({ operationId: op.id, productIds: ids, quantityDelta, reason })],
      );

      return ledgerForOperation(tx, op.id);
    });
  },
});
