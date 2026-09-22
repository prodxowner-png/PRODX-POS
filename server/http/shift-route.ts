import type { Express, Request, Response } from 'express';
import { requirePermission } from './createApp';
import { createShiftService, ShiftError } from '../transactions/shift-service';
import type { TransactionalSqlExecutor } from '../db/transaction';

const centsFromBody=(value:unknown):number=>{
 if(typeof value!=='number'||!Number.isFinite(value)||!Number.isSafeInteger(value)) throw new Error('Money must be supplied as whole cents.');
 return value;
};
const status=(e:ShiftError)=>e.code==='SHIFT_NOT_FOUND'||e.code==='REGISTER_NOT_FOUND'?404:e.code==='SHIFT_ALREADY_OPEN'||e.code==='SHIFT_CLOSED'?409:400;

export const registerShiftRoute=(app:Express,db:TransactionalSqlExecutor):void=>{
 const service=createShiftService(db);
 app.get('/api/v1/shifts/current',requirePermission('pos.sell'),async(req:Request,res:Response)=>{
  const ctx=req.prodxContext;if(!ctx){res.status(500).json({error:{code:'REQUEST_CONTEXT_MISSING',message:'Request context is required.'}});return;}
  const registerId=typeof req.query.registerId==='string'?req.query.registerId.trim():'';
  if(!registerId){res.status(400).json({error:{code:'REGISTER_REQUIRED',message:'Register is required.'}});return;}
  try{res.json(await service.getCurrentShift(ctx.principal.storeId,registerId));}catch{res.status(500).json({error:{code:'SHIFT_READ_FAILED',message:'Unable to load current shift.'}});}
 });
 app.post('/api/v1/shifts/open',requirePermission('pos.sell'),async(req:Request,res:Response)=>{
  const ctx=req.prodxContext;if(!ctx){res.status(500).json({error:{code:'REQUEST_CONTEXT_MISSING',message:'Request context is required.'}});return;}
  try{const body=req.body as Record<string,unknown>;const registerId=typeof body.registerId==='string'?body.registerId.trim():'';const openingFloatCents=centsFromBody(body.openingFloatCents);if(!registerId) throw new ShiftError('REGISTER_NOT_FOUND','Register is required.');res.status(201).json(await service.openShift(ctx.principal.storeId,registerId,ctx.principal.userId,openingFloatCents));}catch(e){if(e instanceof ShiftError){res.status(status(e)).json({error:{code:e.code,message:e.message}});return;}res.status(500).json({error:{code:'SHIFT_OPEN_FAILED',message:'Unable to open shift.'}});}
 });
 app.post('/api/v1/shifts/close',requirePermission('pos.sell'),async(req:Request,res:Response)=>{
  const ctx=req.prodxContext;if(!ctx){res.status(500).json({error:{code:'REQUEST_CONTEXT_MISSING',message:'Request context is required.'}});return;}
  try{const body=req.body as Record<string,unknown>;if(typeof body.shiftId!=='string') throw new ShiftError('SHIFT_NOT_FOUND','Shift is required.');const actual=centsFromBody(body.actualCountedCashCents);const notes=typeof body.notes==='string'?body.notes:'';res.json(await service.closeShift(ctx.principal.storeId,body.shiftId,actual,notes));}catch(e){if(e instanceof ShiftError){res.status(status(e)).json({error:{code:e.code,message:e.message}});return;}res.status(500).json({error:{code:'SHIFT_CLOSE_FAILED',message:'Unable to close shift.'}});}
 });
 app.post('/api/v1/shifts/cash-movements',requirePermission('pos.sell'),async(req:Request,res:Response)=>{
  const ctx=req.prodxContext;if(!ctx){res.status(500).json({error:{code:'REQUEST_CONTEXT_MISSING',message:'Request context is required.'}});return;}
  try{const body=req.body as Record<string,unknown>;const allowed=new Set(['paid_in','paid_out','drawer_drop']);if(typeof body.shiftId!=='string'||typeof body.type!=='string'||!allowed.has(body.type)||typeof body.reason!=='string') throw new ShiftError('INVALID_MOVEMENT','Shift, movement type and reason are required.');const row=await service.recordCashMovement(ctx.principal.storeId,body.shiftId,body.type as any,centsFromBody(body.amountCents),body.reason,ctx.principal.userId);res.status(201).json({id:row.id,shiftId:row.shift_id,type:row.type,amount:{amountInCents:Math.round(Number(row.amount)*100),currency:row.currency},reason:row.reason,performedByUserId:row.performed_by_user_id,timestamp:new Date(row.created_at).toISOString()});}catch(e){if(e instanceof ShiftError){res.status(status(e)).json({error:{code:e.code,message:e.message}});return;}res.status(500).json({error:{code:'CASH_MOVEMENT_FAILED',message:'Unable to record cash movement.'}});}
 });
 app.post('/api/v1/timeclock/clock-in',requirePermission('pos.sell'),async(req:Request,res:Response)=>{
  const ctx=req.prodxContext;if(!ctx){res.status(500).json({error:{code:'REQUEST_CONTEXT_MISSING',message:'Request context is required.'}});return;}
  try{res.status(201).json(await service.clockIn(ctx.principal.storeId,ctx.principal.userId));}catch(e){if(e instanceof ShiftError){res.status(status(e)).json({error:{code:e.code,message:e.message}});return;}res.status(500).json({error:{code:'TIMECLOCK_FAILED',message:'Unable to clock in.'}});}
 });
 app.post('/api/v1/timeclock/clock-out',requirePermission('pos.sell'),async(req:Request,res:Response)=>{
  const ctx=req.prodxContext;if(!ctx){res.status(500).json({error:{code:'REQUEST_CONTEXT_MISSING',message:'Request context is required.'}});return;}
  try{res.json(await service.clockOut(ctx.principal.storeId,ctx.principal.userId));}catch(e){if(e instanceof ShiftError){res.status(status(e)).json({error:{code:e.code,message:e.message}});return;}res.status(500).json({error:{code:'TIMECLOCK_FAILED',message:'Unable to clock out.'}});}
 });
 app.get('/api/v1/timeclock/records',requirePermission('pos.sell'),async(req:Request,res:Response)=>{
  const ctx=req.prodxContext;if(!ctx){res.status(500).json({error:{code:'REQUEST_CONTEXT_MISSING',message:'Request context is required.'}});return;}
  try{res.json(await service.getTimeclockRecords(ctx.principal.storeId));}catch{res.status(500).json({error:{code:'TIMECLOCK_FAILED',message:'Unable to load timeclock records.'}});}
 });
};