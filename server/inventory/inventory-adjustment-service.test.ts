import assert from 'node:assert/strict';
import test from 'node:test';
import type { SqlQueryExecutor, TransactionalSqlExecutor } from '../db/transaction';
import { createInventoryAdjustmentService, InventoryAdjustmentConflictError } from './inventory-adjustment-service';

const makeDb = (rows: Array<Record<string, unknown>> = []): TransactionalSqlExecutor => {
  let operationInserted = true;
  let operationId = 'op-1';
  const ledger: Array<Record<string, unknown>> = [];
  const products = new Map([['product-1', { organization_id: 'org-1', current_stock: 10 }]]);

  const query: SqlQueryExecutor['query'] = async (sql, params = []) => {
    if (sql.includes('INSERT INTO prodx_inventory_adjustments')) {
      if (!operationInserted) return { rows: [] as unknown[] };
      operationInserted = false;
      operationId = String(params[0]);
      return { rows: [{ id: operationId }] as unknown[] };
    }
    if (sql.includes('SELECT id,payload_hash') && sql.includes('prodx_inventory_adjustments')) {
      return { rows: [{ id: operationId, payload_hash: 'different' }] as unknown[] };
    }
    if (sql.includes('SELECT id,store_id,product_id,quantity_delta')) {
      return { rows: ledger as unknown[] };
    }
    if (sql.includes('SELECT organization_id,current_stock')) {
      const p = products.get(String(params[0]));
      return { rows: (p ? [{ ...p }] : []) as unknown[] };
    }
    if (sql.includes('UPDATE prodx_products')) {
      const p = products.get(String(params[1]));
      if (p) p.current_stock = Number(params[0]);
      return { rows: [] as unknown[] };
    }
    if (sql.includes('INSERT INTO prodx_inventory_ledger')) {
      ledger.push({
        id: 'ledger-1',
        store_id: params[2],
        product_id: params[3],
        quantity_delta: params[4],
        resulting_stock: params[5],
        reason: params[6],
        reference_id: params[7],
        performed_by_user_id: params[8],
        created_at: new Date().toISOString(),
      });
      return { rows: [] };
    }
    return { rows: [] };
  };

  return { query, transaction: async (work) => work({ query }) };
};

test('inventory adjustment is transactional and ledger-backed', async () => {
  const db = makeDb();
  const service = createInventoryAdjustmentService(db);
  const entry = await service.adjustStock(
    { organizationId: 'org-1', storeId: 'store-1', userId: 'user-1' },
    'product-1',
    -2,
    'damaged_write_off',
    'idem-1',
  );
  assert.equal(entry.productId, 'product-1');
  assert.equal(entry.resultingStock, 8);
  assert.equal(entry.quantityDelta, -2);
});

test('inventory adjustment rejects zero quantity', async () => {
  const db = makeDb();
  const service = createInventoryAdjustmentService(db);
  await assert.rejects(
    service.adjustStock({ organizationId: 'org-1', storeId: 'store-1', userId: 'user-1' }, 'product-1', 0, 'damaged_write_off', 'idem-1'),
    /non-zero integer/,
  );
});

test('inventory adjustment detects idempotency payload conflict', async () => {
  const db = makeDb();
  const service = createInventoryAdjustmentService(db);
  await service.adjustStock({ organizationId: 'org-1', storeId: 'store-1', userId: 'user-1' }, 'product-1', 1, 'purchase_received', 'idem-1');
  await assert.rejects(
    service.adjustStock({ organizationId: 'org-1', storeId: 'store-1', userId: 'user-1' }, 'product-1', 2, 'purchase_received', 'idem-1'),
    InventoryAdjustmentConflictError,
  );
});
