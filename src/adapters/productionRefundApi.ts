import { resolveProductionApiBaseUrl } from './apiBaseUrl';
import type { Money } from "../domain/money";
import type { RefundItemRestock } from "./types";

const configuredBaseUrl = (): string | undefined => import.meta.env?.VITE_AUTH_API_BASE_URL;
function requireBaseUrl(baseUrl?: string): string {
  return resolveProductionApiBaseUrl(baseUrl ?? configuredBaseUrl());
}
export type ProductionRefundRequest = { orderId:string; refundAmount:Money; reason:string; refundMethod:"cash"|"card"|"qr_digital"; itemsToRestock:readonly RefundItemRestock[]; idempotencyKey:string; supervisorAuthorizationToken:string; };
export type ProductionRefundResponse = { success:true; refundId:string; orderId:string; status:"server_confirmed"|"refunded"; refundedAmount:Money; message:string; idempotencyCached:boolean; };
function errorMessage(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;
  const error = (body as { error?: { message?: unknown } }).error;
  return typeof error?.message === "string" && error.message.trim() ? error.message : fallback;
}
function isRefundResponse(body: unknown): body is ProductionRefundResponse {
  if (typeof body !== "object" || body === null) return false;
  const response = body as Record<string, unknown>;
  return response.success === true && typeof response.refundId === "string" && typeof response.orderId === "string" &&
    (response.status === "server_confirmed" || response.status === "refunded") && typeof response.message === "string" && typeof response.idempotencyCached === "boolean";
}
export function createProductionRefundApi(token: string, baseUrl?: string) {
  return { async refund(request: ProductionRefundRequest): Promise<ProductionRefundResponse> {
    if (!token.trim()) throw new Error("Authenticated session token is required for refund.");
    if (!request.supervisorAuthorizationToken.trim()) throw new Error("Server supervisor authorization is required for refund.");
    const response = await fetch(`${requireBaseUrl(baseUrl)}/api/v1/orders/refund`, {
      method:"POST", credentials:"include",
      headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${token.trim()}`},
      body:JSON.stringify(request),
    });
    const body:unknown=await response.json().catch(()=>null);
    if(!response.ok) throw new Error(errorMessage(body,`Refund request failed (${response.status}).`));
    if(!isRefundResponse(body)) throw new Error("Refund API returned an invalid response.");
    return body;
  }};
}
