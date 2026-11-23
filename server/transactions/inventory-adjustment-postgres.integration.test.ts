import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createPostgresPool, resolveConfiguredDatabaseUrl } from '../db/postgres';
import { createTransactionalPostgresExecutor } from '../db/transaction';
import { assertDisposableTestDatabaseUrl } from '../db/test-database-guard';
import {
  createInventoryAdjustmentService,
  InventoryAdjustmentConflictError,
} from './inventory-adjustment-service';

const url = resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);
if (url) {
  assertDisposableTestDatabaseUrl(url);
}
const pool = url ? createPostgresPool({ connectionString: url, max: 8 }) : null;
const db = pool ? createTransactionalPostgresExecutor(pool) : null;

const id = {
  org: randomUUID(),
  store: randomUUID(),
  user: randomUUID(),
  cat: randomUUID(),
  product: randomUUID(),
};
const runSuffix = id.org.replaceAll('-', '').slice(0, 12);

async function seed(): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL required');
  await pool.query('INSERT INTO prodx_organizations(id,code,name) VALUES($1,$2,$3)', [id.org, `ia-org-${runSuffix}`, 'InvAdj Org']);
  await pool.query("INSERT INTO prodx_stores(id,organization_id,code,name,business_timezone) VALUES($1,$2,$3,'InvAdj Store','Asia/Bangkok')", [id.store, id.org, `ia-store-${runSuffix}`]);
  await pool.query('INSERT INTO prodx_users(id,organization_id,username,display_name) VALUES($1,$2,$3,$4)', [id.user, id.org, `ia-user-${runSuffix}`, 'InvAdj User']);
  await pool.query('INSERT INTO prodx_store_memberships(organization_id,store_id,user_id) VALUES($1,$2,$3)', [id.org, id.store, id.user]);
  await pool.query('INSERT INTO prodx_categories(id,organization_id,store_id,name,slug) VALUES($1,$2,$3,$4,$5)', [id.cat, id.org, id.store, 'InvAdj Cat', `ia-cat-${runSuffix}`]);
  await pool.query("INSERT INTO prodx_products(id,organization_id,store_id,category_id,sku,barcode,name,price_amount,cost_price_amount,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure) VALUES($1,$2,$3,$4,$5,$5,'InvAdj Product',25.00,10.00,'THB',0,5,1,'each')", [id.product, id.org, id.store, id.cat, `IA-1-${runSuffix}`]);
}

test('PostgreSQL inventory adjustments prevent negative stock under concurrency, enforce CHECK constraint, are idempotent, and append to inventory ledger', async (t) => {
  if (!pool || !db) { t.skip('DATABASE_URL not configured'); return; }
  await seed();
  t.after(async () => { await pool.end(); });

  const service = createInventoryAdjustmentService(db);

  // 1. PostgreSQL CHECK (current_stock >= 0) directly blocks negative stock even outside service
  await assert.rejects(
    pool.query('UPDATE prodx_products SET current_stock = -1 WHERE id = $1', [id.product]),
  );

  // 2. Five concurrent -2 deductions against stock=5 -> exactly 2 succeed (5 -> 1), 3 rejected
  const concurrentAttempts = await Promise.allSettled(
    [1, 2, 3, 4, 5].map((n) =>
      service.adjust({
        storeId: id.store,
        organizationId: id.org,
        requesterUserId: id.user,
        productIds: [id.product],
        quantityDelta: -2,
        reason: 'damaged_write_off',
        notes: `Concurrent write-off #${n}`,
        idempotencyKey: `adj-race-${n}-${runSuffix}`,
      }),
    ),
  );

  const succeeded = concurrentAttempts.filter((r) => r.status === 'fulfilled');
  const rejected = concurrentAttempts.filter((r) => r.status === 'rejected');
  assert.equal(succeeded.length, 2);
  assert.equal(rejected.length, 3);
  for (const r of rejected) {
    assert.ok(r.status === 'rejected' && r.reason instanceof InventoryAdjustmentConflictError);
  }
  assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.product])).rows[0].current_stock, 1);

  // 3. Duplicate idempotency replay returns cached result with zero extra stock/ledger mutation
  const restockKey = `adj-restock-${runSuffix}`;
  const firstRestock = await service.adjust({
    storeId: id.store,
    organizationId: id.org,
    requesterUserId: id.user,
    productIds: [id.product],
    quantityDelta: 10,
    reason: 'purchase_received',
    notes: 'Supplier PO-100',
    idempotencyKey: restockKey,
  });
  assert.equal(firstRestock.idempotencyCached, false);
  assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.product])).rows[0].current_stock, 11);

  const replayedRestock = await service.adjust({
    storeId: id.store,
    organizationId: id.org,
    requesterUserId: id.user,
    productIds: [id.product],
    quantityDelta: 10,
    reason: 'purchase_received',
    notes: 'Supplier PO-100',
    idempotencyKey: restockKey,
  });
  assert.equal(replayedRestock.idempotencyCached, true);
  assert.equal(replayedRestock.adjustmentId, firstRestock.adjustmentId);
  assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1', [id.product])).rows[0].current_stock, 11);

  // Mismatched payload with same idempotencyKey fails closed
  await assert.rejects(
    service.adjust({
      storeId: id.store,
      organizationId: id.org,
      requesterUserId: id.user,
      productIds: [id.product],
      quantityDelta: 20,
      reason: 'purchase_received',
      idempotencyKey: restockKey,
    }),
    (error: unknown) => error instanceof InventoryAdjustmentConflictError,
  );

  // 4. Verify ledger entries & audit log count match exact committed operations (2 deductions + 1 restock = 3)
  const ledgerRows = (await pool.query(
    'SELECT quantity_delta, resulting_stock, reason FROM prodx_inventory_ledger WHERE store_id=$1 AND product_id=$2 ORDER BY created_at, id',
    [id.store, id.product],
  )).rows;
  assert.equal(ledgerRows.length, 3);
  assert.equal(ledgerRows.reduce((sum: number, row: { quantity_delta: number }) => sum + Number(row.quantity_delta), 5), 11);

  const auditCount = (await pool.query(
    "SELECT count(*)::int n FROM prodx_audit_log WHERE store_id=$1 AND action='inventory_adjustment_committed'",
    [id.store],
  )).rows[0].n;
  assert.equal(auditCount, 3);
});
