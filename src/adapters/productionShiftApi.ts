import type { IShiftApi } from './types';
import type { Money } from '../domain/money';
import type { Shift, CashMovement, CashMovementType } from '../domain/shift';

const BASE=import.meta.env.VITE_AUTH_API_BASE_URL;
const request=(token:string)=>async<T>(path:string,init?:RequestInit):Promise<T>=>{
 if(!BASE) throw new Error('Production shift API is not configured: VITE_AUTH_API_BASE_URL is missing.');
 if(!token.trim()) throw new Error('Authenticated session token is required for shift operations.');
 const response=await fetch(BASE.replace(/\/$/,'')+path,{credentials:'include',headers:{Accept:'application/json',Authorization:`Bearer ${token.trim()}`,...(init?.body?{'Content-Type':'application/json'}:{})},...init});
 const body=await response.json().catch(()=>null);
 if(!response.ok) throw new Error(body&&typeof body==='object'&&'error'in body?String((body as any).error?.message??'Shift request failed.'):'Shift request failed.');
 return body as T;
};
export function createProductionShiftApi(token:string):Pick<IShiftApi,'getCurrentShift'|'openShift'|'closeShift'|'recordCashMovement'|'clockIn'|'clockOut'|'getTimeclockRecords'>{
 const call=request(token);
 return {
  getCurrentShift:(storeId:string,registerId:string)=>call<Shift>(`/api/v1/shifts/current?registerId=${encodeURIComponent(registerId)}`),
  openShift:(storeId:string,registerId:string,openingFloat:Money)=>call<Shift>('/api/v1/shifts/open',{method:'POST',body:JSON.stringify({registerId,openingFloatCents:openingFloat.amountInCents})}),
  closeShift:(shiftId:string,actualCountedCash:Money,notes?:string)=>call<Shift>('/api/v1/shifts/close',{method:'POST',body:JSON.stringify({shiftId,actualCountedCashCents:actualCountedCash.amountInCents,notes})}),
  recordCashMovement:(shiftId:string,type:CashMovementType,amount:Money,reason:string)=>call<CashMovement>('/api/v1/shifts/cash-movements',{method:'POST',body:JSON.stringify({shiftId,type,amountCents:amount.amountInCents,reason})}),
  clockIn:(storeId:string)=>call<any>('/api/v1/timeclock/clock-in',{method:'POST'}),
  clockOut:(storeId:string)=>call<any>('/api/v1/timeclock/clock-out',{method:'POST'}),
  getTimeclockRecords:(storeId:string)=>call<any[]>('/api/v1/timeclock/records'),
 };
}
