import type { Express, Request, Response } from 'express';
import { requirePermission } from './createApp';
import { createOrderService, OrderVoidError } from '../transactions/order-service';
import type { TransactionalSqlExecutor } from '../db/transaction';

export const registerOrderRoute=(app:Express,db:TransactionalSqlExecutor,permission='pos.sell'):void=>{
 const service=createOrderService(db);
 app.get('/api/v1/orders',requirePermission(permission),async(req:Request,res:Response)=>{
  const ctx=req.prodxContext;if(!ctx){res.status(500).json({error:{code:'REQUEST_CONTEXT_MISSING',message:'Request context is required.'}});return;}
  const limit=Number.parseInt(String(req.query.limit??'100'),10);
  res.json(await service.getOrders(ctx.principal.storeId,Number.isFinite(limit)?limit:100));
 });
 app.get('/api/v1/orders/:orderId',requirePermission(permission),async(req:Request,res:Response)=>{
  const ctx=req.prodxContext;if(!ctx){res.status(500).json({error:{code:'REQUEST_CONTEXT_MISSING',message:'Request context is required.'}});return;}
  const order=await service.getOrder(ctx.principal.storeId,req.params.orderId);
  if(!order){res.status(404).json({error:{code:'ORDER_NOT_FOUND',message:'Order not found.'}});return;}
  res.json(order);
 });
 app.post('/api/v1/orders/void',requirePermission('pos.void'),async(req:Request,res:Response)=>{
  const ctx=req.prodxContext;if(!ctx){res.status(500).json({error:{code:'REQUEST_CONTEXT_MISSING',message:'Request context is required.'}});return;}
  const body=req.body as Record<string,unknown>;
  const sessionId='sessionId'in ctx.principal&&typeof ctx.principal.sessionId==='string'?ctx.principal.sessionId:'';
  if(typeof body.orderId!=='string'||typeof body.reason!=='string'||typeof body.authorizationToken!=='string'||!sessionId){
   res.status(400).json({error:{code:'VOID_VALIDATION_FAILED',message:'Order, reason, authorization and session are required.'}});return;
  }
  try{
   const order=await service.voidOrder({storeId:ctx.principal.storeId,orderId:body.orderId,reason:body.reason,requesterUserId:ctx.principal.userId,requesterSessionId:sessionId,authorizationToken:body.authorizationToken});
   res.status(200).json(order);
  }catch(error){
   if(error instanceof OrderVoidError){res.status(error.code==='ORDER_NOT_FOUND'?404:error.code==='ORDER_ALREADY_FINALIZED'?409:400).json({error:{code:error.code,message:error.message}});return;}
   res.status(500).json({error:{code:'ORDER_VOID_FAILED',message:'Unable to void order.'}});
  }
 });
};