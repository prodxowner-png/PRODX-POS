import crypto from 'node:crypto';
import type { SqlQueryExecutor, TransactionalSqlExecutor } from '../db/transaction';
import { orderFromDb } from './checkout-service';
import { createSupervisorAuthorizationService, SupervisorAuthorizationError } from '../auth/supervisor-authorization';

export class OrderQueryError extends Error { constructor(public readonly code:'ORDER_NOT_FOUND'|'ORDER_STORE_SCOPE'='ORDER_NOT_FOUND',message='Order not found.') { super(message); } }
export class OrderVoidError extends Error { constructor(public readonly code:'ORDER_NOT_FOUND'|'ORDER_ALREADY_FINALIZED'|'VOID_INVALID'='VOID_INVALID',message='Unable to void order.') { super(message); } }

export const createOrderService=(db:TransactionalSqlExecutor)=>({
  async getOrders(storeId:string,limit=100){
    const safe=Math.min(Math.max(Math.trunc(limit)||50,1),200);
    const rows=(await db.query(`SELECT * FROM prodx_orders WHERE store_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2`,[storeId,safe])).rows;
    return Promise.all(rows.map(async row => (await createCheckoutService(db).checkout as any, await (async()=>{ 
      const result=await (await import('./checkout-service')).orderFromDb(db,row,false); return result.order;
    })())));
  },
  async getOrder(storeId:string,orderId:string){
    const row=(await db.query(`SELECT * FROM prodx_orders WHERE store_id=$1 AND id=$2 LIMIT 1`,[storeId,orderId])).rows[0];
    if(!row) return null;
    return (await orderFromDb(db,row,false)).order;
  },
  async voidOrder(input:{storeId:string;orderId:string;reason:string;requesterUserId:string;requesterSessionId:string;authorizationToken:string}){
    if(!input.reason.trim()||!input.authorizationToken.trim()) throw new OrderVoidError('VOID_INVALID','Void reason and supervisor authorization are required.');
    return db.transaction(async tx=>{
      const row=(await tx.query(`SELECT * FROM prodx_orders WHERE store_id=$1 AND id=$2 FOR UPDATE`,[input.storeId,input.orderId])).rows[0];
      if(!row) throw new OrderVoidError('ORDER_NOT_FOUND');
      if(row.status!=='server_confirmed') throw new OrderVoidError('ORDER_ALREADY_FINALIZED','Only server-confirmed orders can be voided.');
      const auth=await createSupervisorAuthorizationService({query:async<T extends Record<string,unknown>>(sql:string,p:readonly unknown[]=[]) => (await tx.query<T>(sql,p)).rows}).consume({
        token:input.authorizationToken,organizationId:row.organization_id,storeId:input.storeId,requesterUserId:input.requesterUserId,requesterSessionId:input.requesterSessionId,action:'void',orderId:input.orderId
      });
      const items=(await tx.query(`SELECT product_id,quantity FROM prodx_order_items WHERE store_id=$1 AND order_id=$2 FOR UPDATE`,[input.storeId,input.orderId])).rows;
      for(const item of items){
        const stock=(await tx.query(`UPDATE prodx_products SET current_stock=current_stock+$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND store_id=$3 RETURNING current_stock`,[item.quantity,item.product_id,input.storeId])).rows[0];
        if(!stock) throw new OrderVoidError('VOID_INVALID','Product for the order is no longer available in the store.');
        await tx.query(`INSERT INTO prodx_inventory_ledger(id,organization_id,store_id,product_id,quantity_delta,resulting_stock,reason,reference_id,performed_by_user_id) VALUES($1,$2,$3,$4,$5,$6,'void_reversal',$7,$8)`,[crypto.randomUUID(),row.organization_id,input.storeId,item.product_id,item.quantity,stock.current_stock,input.orderId,auth.supervisorUserId]);
      }
      const payments=(await tx.query<{amount:string;method:string}>(`SELECT amount::text,method FROM prodx_payments WHERE store_id=$1 AND order_id=$2`,[input.storeId,input.orderId])).rows;
      const cash=payments.filter(p=>p.method==='cash').reduce((s,p)=>s+Number(p.amount),0);
      if(cash>0) await tx.query(`INSERT INTO prodx_cash_movements(id,organization_id,store_id,shift_id,type,amount,reason,performed_by_user_id,currency) VALUES($1,$2,$3,$4,'cash_refund',$5,$6,$7,$8)`,[crypto.randomUUID(),row.organization_id,input.storeId,row.shift_id,cash,input.reason,input.requesterUserId,row.currency]);
      await tx.query(`UPDATE prodx_orders SET status='voided' WHERE id=$1 AND store_id=$2`,[input.orderId,input.storeId]);
      await tx.query(`INSERT INTO prodx_audit_log(id,organization_id,store_id,register_id,user_id,action,severity,details) VALUES($1,$2,$3,$4,$5,'order_voided','warn',$6::jsonb)`,[crypto.randomUUID(),row.organization_id,input.storeId,row.register_id,input.requesterUserId,JSON.stringify({orderId:input.orderId,reason:input.reason,supervisorUserId:auth.supervisorUserId})]);
      const updated=(await tx.query(`SELECT * FROM prodx_orders WHERE id=$1 AND store_id=$2`,[input.orderId,input.storeId])).rows[0];
      return (await orderFromDb(tx,updated,false)).order;
    });
  }
});