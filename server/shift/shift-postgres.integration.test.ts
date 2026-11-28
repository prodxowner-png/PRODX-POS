import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createPostgresPool, resolveConfiguredDatabaseUrl } from '../db/postgres';
import { createTransactionalPostgresExecutor } from '../db/transaction';
import { assertDisposableTestDatabaseUrl } from '../db/test-database-guard';
import { createShiftService, ShiftConflictError } from './shift-service';
import type { User } from '../../src/domain/auth';

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
  reg: randomUUID(),
};
const runSuffix = id.org.replaceAll('-', '').slice(0, 12);

const cashierUsername = `shift-user-${runSuffix}`;
const cashier: User = {
  id: id.user,
  name: 'Shift Cashier',
  email: `${cashierUsername}@prodx.test`,
  role: 'cashier',
  employeeCode: `EMP-${runSuffix.slice(0, 6)}`,
  permissions: ['pos:checkout', 'shift:open', 'shift:close', 'shift:pay_movement'],
  isActive: true,
};

async function seed(): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL required');
  await pool.query('INSERT INTO prodx_organizations(id,code,name) VALUES($1,$2,$3)', [id.org, `sh-org-${runSuffix}`, 'Shift Org']);
  await pool.query("INSERT INTO prodx_stores(id,organization_id,code,name,business_timezone,currency) VALUES($1,$2,$3,'Shift Store','Asia/Bangkok','THB')", [id.store, id.org, `sh-store-${runSuffix}`]);
  await pool.query('INSERT INTO prodx_users(id,organization_id,username,display_name) VALUES($1,$2,$3,$4)', [id.user, id.org, cashierUsername, cashier.name]);
  await pool.query('INSERT INTO prodx_store_memberships(organization_id,store_id,user_id) VALUES($1,$2,$3)', [id.org, id.store, id.user]);
  await pool.query('INSERT INTO prodx_registers(id,organization_id,store_id,code,name) VALUES($1,$2,$3,$4,$5)', [id.reg, id.org, id.store, `SHR1-${runSuffix}`, 'Shift Register']);
}

test('PostgreSQL shift lifecycle calculates exact BigInt expected cash and variance, enforces idempotency, and persists audit trail', async (t) => {
  if (!pool || !db) { t.skip('DATABASE_URL not configured'); return; }
  await seed();
  t.after(async () => { await pool.end(); });

  const service = createShiftService(db);
  const ctx = { organizationId: id.org, storeId: id.store, userId: id.user };

  // 1. Open shift with 2,000.50 THB opening float (200050 cents)
  const openKey = `open-shift-${runSuffix}`;
  const [openedA, openedB] = await Promise.all([
    service.openShift(ctx, id.reg, { amountInCents: 200050, currency: 'THB' }, cashier, openKey),
    service.openShift(ctx, id.reg, { amountInCents: 200050, currency: 'THB' }, cashier, openKey),
  ]);
  assert.equal(openedA.id, openedB.id);
  assert.equal(openedA.status, 'open');
  assert.equal(openedA.openingFloat.amountInCents, 200050);
  assert.equal(openedA.expectedCashInDrawer.amountInCents, 200050);

  // Opening a second shift on the same register fails closed
  await assert.rejects(
    service.openShift(ctx, id.reg, { amountInCents: 100000, currency: 'THB' }, cashier, `open-second-${runSuffix}`),
    (error: unknown) => error instanceof ShiftConflictError,
  );

  // 2. Record paid_in (+500.25), paid_out (-125.10), drawer_drop (-300.00) with idempotent replay
  const paidInKey = `paid-in-${runSuffix}`;
  const m1 = await service.recordCashMovement(ctx, openedA.id, 'paid_in', { amountInCents: 50025, currency: 'THB' }, 'Extra change float', paidInKey);
  const m1Replay = await service.recordCashMovement(ctx, openedA.id, 'paid_in', { amountInCents: 50025, currency: 'THB' }, 'Extra change float', paidInKey);
  assert.equal(m1.id, m1Replay.id);

  // Same key with mismatched payload throws ShiftConflictError
  await assert.rejects(
    service.recordCashMovement(ctx, openedA.id, 'paid_in', { amountInCents: 99999, currency: 'THB' }, 'Tampered amount', paidInKey),
    (error: unknown) => error instanceof ShiftConflictError,
  );

  await service.recordCashMovement(ctx, openedA.id, 'paid_out', { amountInCents: 12510, currency: 'THB' }, 'Ice delivery COD', `paid-out-${runSuffix}`);
  await service.recordCashMovement(ctx, openedA.id, 'drawer_drop', { amountInCents: 30000, currency: 'THB' }, 'Mid-day safe drop', `drop-${runSuffix}`);

  // Also insert server-generated cash_sale (+750.35) and cash_refund (-50.00) to verify full accumulation
  await pool.query(
    "INSERT INTO prodx_cash_movements(id,organization_id,store_id,shift_id,type,amount,reason,performed_by_user_id,currency) VALUES($1,$2,$3,$4,'cash_sale',750.35,'POS Sale',$5,'THB'),($6,$2,$3,$4,'cash_refund',50.00,'POS Refund',$5,'THB')",
    [randomUUID(), id.org, id.store, openedA.id, id.user, randomUUID()],
  );

  // Expected cash = 200050 + 50025 - 12510 - 30000 + 75035 - 5000 = 277600 cents (2776.00 THB)
  const current = await service.getCurrentShift(ctx, id.reg);
  assert.ok(current);
  assert.equal(current.totalPaidIn.amountInCents, 50025);
  assert.equal(current.totalPaidOut.amountInCents, 42510);
  assert.equal(current.totalCashSales.amountInCents, 75035);
  assert.equal(current.totalCashRefunds.amountInCents, 5000);
  assert.equal(current.expectedCashInDrawer.amountInCents, 277600);

  // 3. Close shift with actual counted cash 277550 (50 cents shortage -> variance -50) + idempotent replay
  const closeKey = `close-shift-${runSuffix}`;
  const closed = await service.closeShift(ctx, openedA.id, { amountInCents: 277550, currency: 'THB' }, '50 satang short', closeKey);
  assert.equal(closed.status, 'closed');
  assert.equal(closed.expectedCashInDrawer.amountInCents, 277600);
  assert.equal(closed.actualCountedCash?.amountInCents, 277550);
  assert.equal(closed.variance?.amountInCents, -50);

  const closedReplay = await service.closeShift(ctx, openedA.id, { amountInCents: 277550, currency: 'THB' }, '50 satang short', closeKey);
  assert.equal(closedReplay.status, 'closed');
  assert.equal(closedReplay.variance?.amountInCents, -50);

  // Verify no active shift remains on register
  assert.equal(await service.getCurrentShift(ctx, id.reg), null);

  // 4. Verify audit trail persisted for open, movements, and close
  const auditActions = (await pool.query(
    'SELECT action FROM prodx_audit_log WHERE store_id=$1 ORDER BY created_at, id',
    [id.store],
  )).rows.map((r: { action: string }) => r.action);
  assert.ok(auditActions.includes('shift_opened'));
  assert.ok(auditActions.includes('cash_movement_recorded'));
  assert.ok(auditActions.includes('shift_closed'));
  assert.equal(auditActions.filter((a) => a === 'shift_opened').length, 1);
  assert.equal(auditActions.filter((a) => a === 'shift_closed').length, 1);
});
