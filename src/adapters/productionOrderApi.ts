import type { IOrderApi } from './types';
import type { CheckoutRequest, CheckoutResponse } from './types';
import type { Order } from '../domain/order';

const BASE=import.meta.env.VITE_AUTH_API_BASE_URL;
const createRequest=(token:string)=>async<T>(path:string,init?:RequestInit):Promise<T>=>{
 if(!BASE) throw new Error('Production order API is not configured: VITE_AUTH_API_BASE_URL is missing.');
 if(!token.trim()) throw new Error('Authenticated session token is required for order operations.');
 const response=await fetch(BASE.replace(/\/$/,'')+path,{credentials:'include',headers:{Accept:'application/json',Authorization:`Bearer ${token.trim()}`,...(init?.body?{'Content-Type':'application/json'}:{})},...init});
 const body=await response.json().catch(()=>null);
 if(!response.ok) throw new Error(body&&typeof body==='object'&&'error'in body?String((body as any).error?.message??'Order request failed.'):'Order request failed.');
 return body as T;
};
export function createProductionOrderApi(token:string):Pick<IOrderApi,'createOrder'|'getOrders'|'getOrderById'|'voidOrder'>{
 const request=createRequest(token);
 return {
  createOrder:(req:CheckoutRequest)=>request<CheckoutResponse>('/api/v1/orders/checkout',{method:'POST',body:JSON.stringify(req)}),
  getOrders:(storeId:string,limit=100)=>request<readonly Order[]>(`/api/v1/orders?limit=${Math.min(Math.max(Math.trunc(limit)||50,1),200)}`),
  getOrderById:(storeId:string,orderId:string)=>request<Order|null>(`/api/v1/orders/${encodeURIComponent(orderId)}`),
  voidOrder:(storeId:string,orderId:string,reason:string,authorizedByUserId:string,authorizationToken='')=>request<Order>('/api/v1/orders/void',{method:'POST',body:JSON.stringify({orderId,reason,authorizedByUserId,authorizationToken})}),
 };
}