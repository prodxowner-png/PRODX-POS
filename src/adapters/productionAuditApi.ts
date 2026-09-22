import type { IAuditApi } from './types';
const BASE=import.meta.env.VITE_AUTH_API_BASE_URL;
export function createProductionAuditApi(token:string): IAuditApi {
  const request=async<T>(path:string):Promise<T>=>{
    if(!BASE) throw new Error('Production audit API is not configured: VITE_AUTH_API_BASE_URL is missing.');
    if(!token.trim()) throw new Error('Authenticated session token is required for audit access.');
    const response=await fetch(`${BASE.replace(/\/$/,'')}${path}`,{credentials:'include',headers:{Accept:'application/json',Authorization:`Bearer ${token.trim()}`}});
    const body=await response.json().catch(()=>null);
    if(!response.ok) throw new Error(body?.error?.message??'Audit request failed.');
    return body as T;
  };
  return {
    recordEvent: async()=>{throw new Error('Client audit writes are server-authoritative and are not exposed as a generic client mutation.');},
    getLogs:(storeId,limit=50)=>request<Awaited<ReturnType<IAuditApi['getLogs']>>>(`/api/v1/audit/logs?limit=${Math.min(Math.max(limit,1),200)}`),
  };
}