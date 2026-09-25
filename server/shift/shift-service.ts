import crypto from 'node:crypto';
import type { SqlQueryExecutor, TransactionalSqlExecutor } from '../db/transaction';
import type { CashMovement, CashMovementType, Shift } from '../../src/domain/shift';
import type { Money } from '../../src/domain/money';
import type { User } from '../../src/domain/auth';

export class ShiftValidationError extends Error { readonly code = 'SHIFT_VALIDATION_FAILED'; }
export class ShiftConflictError extends Error { readonly code = 'SHIFT_CONFLICT'; }

type Context = { organizationId: string; storeId: string; userId: string };
type ShiftRow = {
  id: string; store_id: string; register_id: string; cashier_id: string; cashier_name: string;
  opened_at: string | Date; closed_at?: string | Date | null; status: 'open'|'closed';
  opening_float_amount: string|number; actual_counted_cash_amount?: string|number|null; currency: string;
};
type MovementRow = {
  id:string; shift_id:string; type:CashMovementType; amount:string|number; reason:string;
  performed_by_user_id:string; currency:string; created_at:string|Date;
};

const cents = (money: Money, label: string) => {
  if (!Number.isSafeInteger(money.amountInCents) || money.amountInCents < 0) throw new ShiftValidationError(`${label} must be a non-negative integer amount.`);
  if (!money.currency || money.currency.length !== 3) throw new ShiftValidationError(`${label} currency is invalid.`);
  return money.amountInCents;
};
const money = (value: string|number, currency: string): Money => ({ amountInCents: Number(value) * 100, currency });
const hash = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const mapMovement = (r: MovementRow): CashMovement => ({
  id:r.id, shiftId:r.shift_id, type:r.type, amount:money(r.amount,r.currency),
  reason:r.reason, performedByUserId:r.performed_by_user_id, timestamp:new Date(r.created_at).toISOString(),
});

const loadShift = async (db: SqlQueryExecutor, shiftId: string, storeId: string): Promise<Shift> => {
  const s = await db.query<ShiftRow>(`SELECT s.id,s.store_id,s.register_id,s.cashier_id,u.display_name AS cashier_name,s.opened_at,s.closed_at,s.status,s.opening_float_amount,s.actual_counted_cash_amount,s.currency FROM prodx_shifts s JOIN prodx_users u ON u.id=s.cashier_id WHERE s.id=$1 AND s.store_id=$2`,[shiftId,storeId]);
  const row=s.rows[0]; if(!row) throw new ShiftConflictError('Shift not found in this store.');
  const m=await db.query<MovementRow>(`SELECT id,shift_id,type,amount,reason,performed_by_user_id,currency,created_at FROM prodx_cash_movements WHERE shift_id=$1 AND store_id=$2 ORDER BY created_at,id`,[shiftId,storeId]);
  const movements=m.rows.map(mapMovement);
  let expected=0;
  let cashSales=0,cashRefunds=0,paidIn=0,paidOut=0;
  for(const x of m.rows){const a=Number(x.amount); if(x.type==='opening_float'){expected+=a;} else if(x.type==='cash_sale'){cashSales+=a;expected+=a;} else if(x.type==='cash_refund'){cashRefunds+=a;expected-=a;} else if(x.type==='paid_in'){paidIn+=a;expected+=a;} else if(x.type==='paid_out'||x.type==='drawer_drop'){paidOut+=a;expected-=a;} }
  const actual=row.actual_counted_cash_amount==null?undefined:money(row.actual_counted_cash_amount,row.currency);
  return {id:row.id,storeId:row.store_id,registerId:row.register_id,cashierId:row.cashier_id,cashierName:row.cashier_name,openedAt:new Date(row.opened_at).toISOString(),closedAt:row.closed_at?new Date(row.closed_at).toISOString():undefined,status:row.status,openingFloat:money(row.opening_float_amount,row.currency),movements,totalCashSales:money(cashSales,row.currency),totalCashRefunds:money(cashRefunds,row.currency),totalPaidIn:money(paidIn,row.currency),totalPaidOut:money(paidOut,row.currency),expectedCashInDrawer:money(expected,row.currency),actualCountedCash:actual,variance:actual?{amountInCents:actual.amountInCents-Math.round(expected*100),currency:row.currency}:undefined};
};

const operation = async (tx: SqlQueryExecutor, context: Context, type: 'open_shift'|'close_shift'|'cash_movement', shiftId: string|null, key:string, payload:unknown) => {
  const h=hash(payload);
  const inserted=await tx.query<{id:string}>(`INSERT INTO prodx_shift_operations(id,organization_id,store_id,shift_id,operation_type,idempotency_key,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(store_id,operation_type,idempotency_key) DO NOTHING RETURNING id`,[crypto.randomUUID(),context.organizationId,context.storeId,shiftId,type,key.trim(),h]);
  if(inserted.rows[0]) return {id:inserted.rows[0].id,replay:false};
  const existing=await tx.query<{id:string;payload_hash:string}>(`SELECT id,payload_hash FROM prodx_shift_operations WHERE store_id=$1 AND operation_type=$2 AND idempotency_key=$3 FOR UPDATE`,[context.storeId,type,key.trim()]);
  const row=existing.rows[0]; if(!row||row.payload_hash!==h) throw new ShiftConflictError('Idempotency key was already used for a different shift operation.');
  return {id:row.id,replay:true};
};

export const createShiftService = (db: TransactionalSqlExecutor) => ({
  async getCurrentShift(context: Context, registerId:string) {
    const r=await db.query<ShiftRow>(`SELECT s.id,s.store_id,s.register_id,s.cashier_id,u.display_name AS cashier_name,s.opened_at,s.closed_at,s.status,s.opening_float_amount,s.actual_counted_cash_amount,s.currency FROM prodx_shifts s JOIN prodx_users u ON u.id=s.cashier_id WHERE s.store_id=$1 AND s.register_id=$2 AND s.status='open'`,[context.storeId,registerId]);
    return r.rows[0]?loadShift(db,r.rows[0].id,context.storeId):null;
  },
  async openShift(context:Context,registerId:string,openingFloat:Money,cashier:User,idempotencyKey:string) {
    const amount=cents(openingFloat,'Opening float');
    if(!registerId.trim()||!cashier.id) throw new ShiftValidationError('Register and cashier are required.');
    return db.transaction(async tx=>{
      const op=await operation(tx,context,'open_shift',null,idempotencyKey,{registerId,openingFloat:amount,currency:openingFloat.currency,cashierId:cashier.id});
      if(op.replay) {
        const prior=await tx.query<{shift_id:string}>(`SELECT shift_id FROM prodx_shift_operations WHERE id=$1`,[op.id]);
        if(!prior.rows[0]?.shift_id) throw new ShiftConflictError('Open shift operation is incomplete.');
        return loadShift(tx,prior.rows[0].shift_id,context.storeId);
      }
      const existing=await tx.query<{id:string}>(`SELECT id FROM prodx_shifts WHERE register_id=$1 AND store_id=$2 AND status='open' FOR UPDATE`,[registerId,context.storeId]);
      if(existing.rows[0]) throw new ShiftConflictError('Register already has an open shift.');
      const id=crypto.randomUUID();
      await tx.query(`INSERT INTO prodx_shifts(id,organization_id,store_id,register_id,cashier_id,status,opening_float_amount,currency) VALUES($1,$2,$3,$4,$5,'open',$6,$7)`,[id,context.organizationId,context.storeId,registerId,cashier.id,amount/100,openingFloat.currency]);
      await tx.query(`UPDATE prodx_shift_operations SET shift_id=$1 WHERE id=$2`,[id,op.id]);
      await tx.query(`INSERT INTO prodx_cash_movements(id,organization_id,store_id,shift_id,type,amount,reason,performed_by_user_id,currency) VALUES($1,$2,$3,$4,'opening_float',$5,$6,$7,$8)`,[crypto.randomUUID(),context.organizationId,context.storeId,id,amount/100,'Initial opening cash drawer float',context.userId,openingFloat.currency]);
      await tx.query(`INSERT INTO prodx_audit_log(id,organization_id,store_id,register_id,user_id,action,severity,details) VALUES($1,$2,$3,$4,$5,'shift_opened','info',$6::jsonb)`,[crypto.randomUUID(),context.organizationId,context.storeId,registerId,context.userId,JSON.stringify({shiftId:id,openingFloat:amount})]);
      return loadShift(tx,id,context.storeId);
    });
  },
  async closeShift(context:Context,shiftId:string,actualCountedCash:Money,notes:string|undefined,idempotencyKey:string) {
    const actual=cents(actualCountedCash,'Counted cash');
    return db.transaction(async tx=>{
      const op=await operation(tx,context,'close_shift',shiftId,idempotencyKey,{shiftId,actualCountedCash:actual,currency:actualCountedCash.currency,notes:notes??''});
      if(op.replay) return loadShift(tx,shiftId,context.storeId);
      const locked=await tx.query<ShiftRow>(`SELECT s.id,s.store_id,s.register_id,s.cashier_id,u.display_name AS cashier_name,s.opened_at,s.closed_at,s.status,s.opening_float_amount,s.actual_counted_cash_amount,s.currency FROM prodx_shifts s JOIN prodx_users u ON u.id=s.cashier_id WHERE s.id=$1 AND s.store_id=$2 FOR UPDATE`,[shiftId,context.storeId]);
      const shift=locked.rows[0]; if(!shift) throw new ShiftConflictError('Shift not found in this store.'); if(shift.status!=='open') throw new ShiftConflictError('Shift is already closed.');
      if(shift.currency!==actualCountedCash.currency) throw new ShiftValidationError('Counted cash currency does not match the shift.');
      await tx.query(`UPDATE prodx_shifts SET status='closed',closed_at=CURRENT_TIMESTAMP,actual_counted_cash_amount=$1 WHERE id=$2 AND store_id=$3`,[actual/100,shiftId,context.storeId]);
      await tx.query(`INSERT INTO prodx_audit_log(id,organization_id,store_id,register_id,user_id,action,severity,details) VALUES($1,$2,$3,$4,$5,'shift_closed','info',$6::jsonb)`,[crypto.randomUUID(),context.organizationId,context.storeId,shift.register_id,context.userId,JSON.stringify({shiftId,actualCountedCash:actual,notes:notes??''})]);
      return loadShift(tx,shiftId,context.storeId);
    });
  },
  async recordCashMovement(context:Context,shiftId:string,type:CashMovementType,amount:Money,reason:string,idempotencyKey:string) {
    const value=cents(amount,'Cash movement'); if(value<=0||!reason.trim()) throw new ShiftValidationError('Cash movement amount and reason are required.');
    if(type==='cash_sale'||type==='cash_refund'||type==='opening_float') throw new ShiftValidationError('This cash movement type is server-generated and cannot be manually posted.');
    return db.transaction(async tx=>{
      const op=await operation(tx,context,'cash_movement',shiftId,idempotencyKey,{shiftId,type,amount:value,currency:amount.currency,reason});
      if(op.replay){const r=await tx.query<MovementRow>(`SELECT id,shift_id,type,amount,reason,performed_by_user_id,created_at FROM prodx_cash_movements WHERE id=$1`,[op.id]); if(!r.rows[0]) throw new ShiftConflictError('Cash movement operation is incomplete.'); return mapMovement(r.rows[0]);}
      const shift=await tx.query<ShiftRow>(`SELECT id,status,currency FROM prodx_shifts WHERE id=$1 AND store_id=$2 FOR UPDATE`,[shiftId,context.storeId]);
      const s=shift.rows[0]; if(!s) throw new ShiftConflictError('Shift not found in this store.'); if(s.status!=='open') throw new ShiftConflictError('Shift is closed.'); if(s.currency!==amount.currency) throw new ShiftValidationError('Cash movement currency does not match the shift.');
      const id=crypto.randomUUID();
      await tx.query(`INSERT INTO prodx_cash_movements(id,organization_id,store_id,shift_id,type,amount,reason,performed_by_user_id,currency) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,context.organizationId,context.storeId,shiftId,type,value/100,reason.trim(),context.userId,amount.currency]);
      await tx.query(`UPDATE prodx_shift_operations SET id=$1 WHERE id=$2`,[id,op.id]);
      await tx.query(`INSERT INTO prodx_audit_log(id,organization_id,store_id,user_id,action,severity,details) VALUES($1,$2,$3,$4,$5,'info',$6::jsonb)`,[crypto.randomUUID(),context.organizationId,context.storeId,context.userId,'cash_movement_recorded',JSON.stringify({shiftId,type,amount:value,reason})]);
      const r=await tx.query<MovementRow>(`SELECT id,shift_id,type,amount,reason,performed_by_user_id,created_at FROM prodx_cash_movements WHERE id=$1`,[id]); return mapMovement(r.rows[0]);
    });
  }
});
