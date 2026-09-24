import type { Express, Request, Response } from 'express';
import { requirePermission } from './createApp';
import type { TransactionalSqlExecutor } from '../db/transaction';
import { createShiftService, ShiftConflictError, ShiftValidationError } from '../shift/shift-service';
import { createMoney } from '../../src/domain/money';
import type { CashMovementType } from '../../src/domain/shift';

const error = (res:Response, req:Request, status:number, code:string, message:string) => res.status(status).json({error:{code,message,requestId:req.id}});

export const registerShiftRoute = (app:Express, db:TransactionalSqlExecutor) => {
  const service=createShiftService(db);

  app.get('/api/v1/shifts/current', requirePermission('shift:open'), async (req:Request,res:Response)=>{
    const ctx=req.prodxContext; if(!ctx) return error(res,req,500,'REQUEST_CONTEXT_MISSING','Request context is required.');
    const registerId=String(req.query.registerId??''); if(!registerId.trim()) return error(res,req,400,'INVALID_REQUEST','registerId is required.');
    const shift=await service.getCurrentShift({organizationId:ctx.principal.organizationId,storeId:ctx.principal.storeId,userId:ctx.principal.userId},registerId);
    return res.json(shift);
  });

  app.post('/api/v1/shifts/open', requirePermission('shift:open'), async (req:Request,res:Response)=>{
    try{
      const ctx=req.prodxContext;if(!ctx)return error(res,req,500,'REQUEST_CONTEXT_MISSING','Request context is required.');
      const b=req.body as {registerId?:string;openingFloat?:{amountInCents?:number;currency?:string};cashierId?:string;cashierName?:string;idempotencyKey?:string};
      if(!b?.registerId||!b.openingFloat||typeof b.openingFloat.amountInCents!=='number'||typeof b.openingFloat.currency!=='string'||!b.idempotencyKey)return error(res,req,400,'INVALID_REQUEST','Register, opening float and idempotency key are required.');
      const shift=await service.openShift({organizationId:ctx.principal.organizationId,storeId:ctx.principal.storeId,userId:ctx.principal.userId},b.registerId,createMoney(b.openingFloat.amountInCents,b.openingFloat.currency),{id:ctx.principal.userId,name:b.cashierName??ctx.principal.userId} as any,b.idempotencyKey);
      return res.status(201).json(shift);
    }catch(e){if(e instanceof ShiftValidationError)return error(res,req,400,e.code,e.message);if(e instanceof ShiftConflictError)return error(res,req,409,e.code,e.message);throw e;}
  });

  app.post('/api/v1/shifts/:shiftId/close', requirePermission('shift:close'), async (req:Request,res:Response)=>{
    try{
      const ctx=req.prodxContext;if(!ctx)return error(res,req,500,'REQUEST_CONTEXT_MISSING','Request context is required.');
      const b=req.body as {actualCountedCash?:{amountInCents?:number;currency?:string};notes?:string;idempotencyKey?:string};
      if(!b?.actualCountedCash||typeof b.actualCountedCash.amountInCents!=='number'||typeof b.actualCountedCash.currency!=='string'||!b.idempotencyKey)return error(res,req,400,'INVALID_REQUEST','Counted cash and idempotency key are required.');
      return res.json(await service.closeShift({organizationId:ctx.principal.organizationId,storeId:ctx.principal.storeId,userId:ctx.principal.userId},req.params.shiftId,createMoney(b.actualCountedCash.amountInCents,b.actualCountedCash.currency),b.notes,b.idempotencyKey));
    }catch(e){if(e instanceof ShiftValidationError)return error(res,req,400,e.code,e.message);if(e instanceof ShiftConflictError)return error(res,req,409,e.code,e.message);throw e;}
  });

  app.post('/api/v1/shifts/:shiftId/cash-movements', requirePermission('shift:pay_movement'), async (req:Request,res:Response)=>{
    try{
      const ctx=req.prodxContext;if(!ctx)return error(res,req,500,'REQUEST_CONTEXT_MISSING','Request context is required.');
      const b=req.body as {type?:CashMovementType;amount?:{amountInCents?:number;currency?:string};reason?:string;idempotencyKey?:string};
      if(!b?.type||!b.amount||typeof b.amount.amountInCents!=='number'||typeof b.amount.currency!=='string'||!b.reason||!b.idempotencyKey)return error(res,req,400,'INVALID_REQUEST','Cash movement fields and idempotency key are required.');
      return res.status(201).json(await service.recordCashMovement({organizationId:ctx.principal.organizationId,storeId:ctx.principal.storeId,userId:ctx.principal.userId},req.params.shiftId,b.type,createMoney(b.amount.amountInCents,b.amount.currency),b.reason,b.idempotencyKey));
    }catch(e){if(e instanceof ShiftValidationError)return error(res,req,400,e.code,e.message);if(e instanceof ShiftConflictError)return error(res,req,409,e.code,e.message);throw e;}
  });
};
