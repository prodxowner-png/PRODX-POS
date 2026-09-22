import crypto from 'node:crypto';
import type { TransactionalSqlExecutor, SqlQueryExecutor } from '../db/transaction';

type Money = { amountInCents: number; currency: string };
type ShiftStatus = 'open' | 'closed';
type CashMovementType = 'opening_float' | 'cash_sale' | 'cash_refund' | 'paid_in' | 'paid_out' | 'drawer_drop';

export class ShiftError extends Error {
  constructor(public readonly code: 'SHIFT_NOT_FOUND'|'SHIFT_ALREADY_OPEN'|'SHIFT_CLOSED'|'INVALID_AMOUNT'|'INVALID_MOVEMENT'|'REGISTER_NOT_FOUND', message: string) { super(message); }
}

const cents=(value: string|number):number=>{
  const text=String(value).trim();
  const m=text.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if(!m) throw new Error('Invalid monetary value returned by database.');
  return Number(m[1])*100+Number((m[2]??'').padEnd(2,'0'));
};
const money=(value:string|number,currency:string):Money=>({amountInCents:cents(value),currency});

const loadShift=async(db:SqlQueryExecutor,storeId:string,shiftId:string)=>{
  const s=(await db.query<any>(`SELECT s.id,s.store_id,s.register_id,s.cashier_id,s.status,s.opened_at,s.closed_at,s.opening_float_amount::text,s.actual_counted_cash_amount::text,s.currency,u.display_name
    FROM prodx_shifts s JOIN prodx_users u ON u.id=s.cashier_id
    WHERE s.store_id=$1 AND s.id=$2`,[storeId,shiftId])).rows[0];
  if(!s) throw new ShiftError('SHIFT_NOT_FOUND','Shift not found.');
  const movements=(await db.query<any>(`SELECT id,shift_id,type,amount::text,reason,performed_by_user_id,created_at
    FROM prodx_cash_movements WHERE store_id=$1 AND shift_id=$2 ORDER BY created_at,id`,[storeId,shiftId])).rows;
  let expected=cents(s.opening_float_amount),sales=0,refunds=0,paidIn=0,paidOut=0;
  for(const m of movements){
    const a=cents(m.amount);
    if(m.type==='cash_sale'||m.type==='paid_in'||m.type==='opening_float') expected+=a;
    if(m.type==='cash_refund'||m.type==='paid_out'||m.type==='drawer_drop') expected-=a;
    if(m.type==='cash_sale') sales+=a;
    if(m.type==='cash_refund') refunds+=a;
    if(m.type==='paid_in') paidIn+=a;
    if(m.type==='paid_out') paidOut+=a;
  }
  const actual=s.actual_counted_cash_amount==null?undefined:cents(s.actual_counted_cash_amount);
  return {id:s.id,storeId:s.store_id,registerId:s.register_id,cashierId:s.cashier_id,cashierName:s.display_name,openedAt:new Date(s.opened_at).toISOString(),closedAt:s.closed_at?new Date(s.closed_at).toISOString():undefined,status:s.status as ShiftStatus,openingFloat:money(s.opening_float_amount,s.currency),movements:movements.map((m:any)=>({id:m.id,shiftId:m.shift_id,type:m.type as CashMovementType,amount:money(m.amount,s.currency),reason:m.reason,performedByUserId:m.performed_by_user_id,timestamp:new Date(m.created_at).toISOString()})),totalCashSales:money((sales/100).toFixed(2),s.currency),totalCashRefunds:money((refunds/100).toFixed(2),s.currency),totalPaidIn:money((paidIn/100).toFixed(2),s.currency),totalPaidOut:money((paidOut/100).toFixed(2),s.currency),expectedCashInDrawer:money((expected/100).toFixed(2),s.currency),actualCountedCash:actual===undefined?undefined:money((actual/100).toFixed(2),s.currency),variance:actual===undefined?undefined:money(((actual-expected)/100).toFixed(2),s.currency)};
};

export const createShiftService=(db:TransactionalSqlExecutor)=>{
 const getCurrentShift=async(storeId:string,registerId:string)=>{ const row=(await db.query<any>(`SELECT id FROM prodx_shifts WHERE store_id=$1 AND register_id=$2 AND status='open'`,[storeId,registerId])).rows[0]; return row?loadShift(db,storeId,row.id):null; };
 const openShift=async(storeId:string,registerId:string,userId:string,openingFloatCents:number)=>{
  if(!Number.isSafeInteger(openingFloatCents)||openingFloatCents<0) throw new ShiftError('INVALID_AMOUNT','Opening float must be a non-negative whole-cent amount.');
  return db.transaction(async tx=>{
   const reg=(await tx.query<any>(`SELECT id FROM prodx_registers WHERE id=$1 AND store_id=$2 AND status='active'`,[registerId,storeId])).rows[0];
   if(!reg) throw new ShiftError('REGISTER_NOT_FOUND','Register not found or inactive.');
   const existing=(await tx.query<any>(`SELECT id FROM prodx_shifts WHERE register_id=$1 AND status='open' FOR UPDATE`,[registerId])).rows[0];
   if(existing) throw new ShiftError('SHIFT_ALREADY_OPEN','This register already has an open shift.');
   const id=crypto.randomUUID();
   await tx.query(`INSERT INTO prodx_shifts(id,organization_id,store_id,register_id,cashier_id,opening_float_amount,currency)
     SELECT $1,organization_id,id, $2,$3,$4,'THB' FROM prodx_stores WHERE id=$5`,[id,registerId,userId,openingFloatCents/100,storeId]);
   await tx.query(`INSERT INTO prodx_cash_movements(id,organization_id,store_id,shift_id,type,amount,reason,performed_by_user_id,currency)
     SELECT $1,organization_id,id,$2,'opening_float',$3,'Initial opening cash drawer float',$4,'THB' FROM prodx_stores WHERE id=$5`,[crypto.randomUUID(),id,openingFloatCents/100,userId,storeId]);
   return loadShift(tx,storeId,id);
  });
 };
 const closeShift=async(storeId:string,shiftId:string,actualCountedCashCents:number,notes?:string)=>{
  if(!Number.isSafeInteger(actualCountedCashCents)||actualCountedCashCents<0) throw new ShiftError('INVALID_AMOUNT','Counted cash must be a non-negative whole-cent amount.');
  return db.transaction(async tx=>{
   const row=(await tx.query<any>(`SELECT id,status FROM prodx_shifts WHERE id=$1 AND store_id=$2 FOR UPDATE`,[shiftId,storeId])).rows[0];
   if(!row) throw new ShiftError('SHIFT_NOT_FOUND','Shift not found.');
   if(row.status!=='open') throw new ShiftError('SHIFT_CLOSED','Shift is already closed.');
   await tx.query(`UPDATE prodx_shifts SET status='closed',closed_at=CURRENT_TIMESTAMP,actual_counted_cash_amount=$3 WHERE id=$1 AND store_id=$2`,[shiftId,storeId,actualCountedCashCents/100]);
   if(notes?.trim()) await tx.query(`INSERT INTO prodx_audit_log(id,organization_id,store_id,register_id,user_id,action,severity,details)
     SELECT $1,organization_id,store_id,register_id,cashier_id,'shift_closed','info',jsonb_build_object('shiftId',$2,'notes',$3)
     FROM prodx_shifts WHERE id=$2`,[crypto.randomUUID(),shiftId,notes.trim()]);
   return loadShift(tx,storeId,shiftId);
  });
 };
 const clockIn=async(storeId:string,userId:string)=>{
  return db.transaction(async tx=>{
   const user=(await tx.query<any>(`SELECT id,organization_id,display_name FROM prodx_users WHERE id=$1 AND organization_id=(SELECT organization_id FROM prodx_stores WHERE id=$2)`,[userId,storeId])).rows[0];
   if(!user) throw new ShiftError('SHIFT_NOT_FOUND','Authenticated user is not a member of this store.');
   const existing=(await tx.query<any>(`SELECT id FROM prodx_timeclock_records WHERE store_id=$1 AND user_id=$2 AND status='clocked_in' FOR UPDATE`,[storeId,userId])).rows[0];
   if(existing) throw new ShiftError('SHIFT_ALREADY_OPEN','User is already clocked in.');
   const shift=(await tx.query<any>(`SELECT id FROM prodx_shifts WHERE store_id=$1 AND cashier_id=$2 AND status='open' ORDER BY opened_at DESC LIMIT 1`,[storeId,userId])).rows[0];
   const id=crypto.randomUUID();
   await tx.query(`INSERT INTO prodx_timeclock_records(id,organization_id,store_id,user_id,shift_id,status) VALUES($1,$2,$3,$4,$5,'clocked_in')`,[id,user.organization_id,storeId,userId,shift?.id??null]);
   return {id,userId,userName:user.display_name,employeeCode:user.id,shiftId:shift?.id,status:'clocked_in',clockedInAt:new Date().toISOString()};
  });
 };
 const clockOut=async(storeId:string,userId:string)=>{
  return db.transaction(async tx=>{
   const row=(await tx.query<any>(`SELECT id,clocked_in_at,shift_id FROM prodx_timeclock_records WHERE store_id=$1 AND user_id=$2 AND status='clocked_in' FOR UPDATE`,[storeId,userId])).rows[0];
   if(!row) throw new ShiftError('SHIFT_NOT_FOUND','User is not clocked in.');
   await tx.query(`UPDATE prodx_timeclock_records SET status='clocked_out',clocked_out_at=CURRENT_TIMESTAMP WHERE id=$1`,[row.id]);
   const user=(await tx.query<any>(`SELECT display_name,id FROM prodx_users WHERE id=$1`,[userId])).rows[0];
   return {id:row.id,userId,userName:user.display_name,employeeCode:user.id,shiftId:row.shift_id??undefined,status:'clocked_out',clockedInAt:new Date(row.clocked_in_at).toISOString(),clockedOutAt:new Date().toISOString()};
  });
 };
 const getTimeclockRecords=async(storeId:string)=>{
  const rows=(await db.query<any>(`SELECT t.id,t.user_id,t.shift_id,t.status,t.clocked_in_at,t.clocked_out_at,u.display_name FROM prodx_timeclock_records t JOIN prodx_users u ON u.id=t.user_id WHERE t.store_id=$1 ORDER BY t.clocked_in_at DESC LIMIT 200`,[storeId])).rows;
  return rows.map((r:any)=>({id:r.id,userId:r.user_id,userName:r.display_name,employeeCode:r.user_id,shiftId:r.shift_id??undefined,status:r.status,clockedInAt:new Date(r.clocked_in_at).toISOString(),clockedOutAt:r.clocked_out_at?new Date(r.clocked_out_at).toISOString():undefined}));
 };
 const recordCashMovement=async(storeId:string,shiftId:string,type:CashMovementType,amountCents:number,reason:string,userId:string)=>{
  if(!Number.isSafeInteger(amountCents)||amountCents<=0) throw new ShiftError('INVALID_AMOUNT','Cash movement amount must be positive whole cents.');
  if(!reason.trim()) throw new ShiftError('INVALID_MOVEMENT','Cash movement reason is required.');
  return db.transaction(async tx=>{
   const shift=(await tx.query<any>(`SELECT id,organization_id,currency,status FROM prodx_shifts WHERE id=$1 AND store_id=$2 FOR UPDATE`,[shiftId,storeId])).rows[0];
   if(!shift) throw new ShiftError('SHIFT_NOT_FOUND','Shift not found.');
   if(shift.status!=='open') throw new ShiftError('SHIFT_CLOSED','Cannot record movement on a closed shift.');
   if(type==='opening_float'||type==='cash_sale'||type==='cash_refund') throw new ShiftError('INVALID_MOVEMENT','This movement type is server-owned by the transaction lifecycle.');
   const id=crypto.randomUUID();
   await tx.query(`INSERT INTO prodx_cash_movements(id,organization_id,store_id,shift_id,type,amount,reason,performed_by_user_id,currency)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,shift.organization_id,storeId,shiftId,type,amountCents/100,reason.trim(),userId,shift.currency]);
   return (await tx.query<any>(`SELECT id,shift_id,type,amount::text,reason,performed_by_user_id,created_at,currency FROM prodx_cash_movements WHERE id=$1`,[id])).rows[0];
  });
 };
 return {getCurrentShift,openShift,closeShift,recordCashMovement,clockIn,clockOut,getTimeclockRecords};
};
