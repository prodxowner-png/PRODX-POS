import assert from 'node:assert/strict';
import test from 'node:test';
import type { SqlQueryExecutor, TransactionalSqlExecutor } from '../db/transaction';
import { createShiftService, ShiftConflictError } from './shift-service';
import { createMoney } from '../../src/domain/money';

const db = (): TransactionalSqlExecutor => {
  let opInserted = true;
  let opId = 'op-1';
  const calls: string[] = [];
  const query: SqlQueryExecutor['query'] = async (sql, params = []) => {
    calls.push(sql);
    if (sql.includes('INSERT INTO prodx_shift_operations')) {
      if (!opInserted) return { rows: [] as T[] };
      opInserted = false; opId = String(params[0]); return { rows: [{ id: opId }] as T[] };
    }
    if (sql.includes('SELECT id,payload_hash') && sql.includes('prodx_shift_operations')) return { rows: [{ id: opId, payload_hash: 'different' }] as T[] };
    if (sql.includes('SELECT id FROM prodx_shifts WHERE register_id')) return { rows: [] };
    if (sql.includes('INSERT INTO prodx_shifts')) return { rows: [] };
    if (sql.includes('SELECT s.id,s.store_id')) return { rows: [{ id:'shift-1',store_id:'store-1',register_id:'reg-1',cashier_id:'user-1',cashier_name:'Cashier',opened_at:new Date().toISOString(),closed_at:null,status:'open',opening_float_amount:'100.00',actual_counted_cash_amount:null,currency:'THB' }] as T[] };
    if (sql.includes('FROM prodx_cash_movements')) return { rows: [{ id:'mov-1',shift_id:'shift-1',type:'opening_float',amount:'100.00',reason:'Initial opening cash drawer float',performed_by_user_id:'user-1',currency:'THB',created_at:new Date().toISOString() }] as T[] };
    return { rows: [] };
  };
  return { query, transaction: async work => work({ query }) };
};

test('open shift persists authoritative cash opening in one transaction', async () => {
  const service = createShiftService(db());
  const shift = await service.openShift(
    { organizationId:'org-1', storeId:'store-1', userId:'user-1' },
    'reg-1',
    createMoney(10000,'THB'),
    { id:'user-1', name:'Cashier' } as any,
    'open-1',
  );
  assert.equal(shift.id, 'shift-1');
  assert.equal(shift.openingFloat.amountInCents, 10000);
  assert.equal(shift.expectedCashInDrawer.amountInCents, 10000);
});

test('reused shift idempotency key with different payload is rejected', async () => {
  const service = createShiftService(db());
  await service.openShift({organizationId:'org-1',storeId:'store-1',userId:'user-1'},'reg-1',createMoney(10000),{id:'user-1',name:'Cashier'} as any,'open-1');
  await assert.rejects(
    service.openShift({organizationId:'org-1',storeId:'store-1',userId:'user-1'},'reg-1',createMoney(20000),{id:'user-1',name:'Cashier'} as any,'open-1'),
    ShiftConflictError,
  );
});
