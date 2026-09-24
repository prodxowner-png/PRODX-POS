/**
 * PRODX POS - API Adapter Interface Contracts
 * 
 * Formal typed boundaries separating UI and application services from the
 * infrastructure / backend API layer (e.g. NestJS + PostgreSQL).
 */

import { User, SessionContext, Store } from '../domain/auth';
import {
  Product,
  Category,
  InventoryLedgerEntry,
  StockMovementReason,
  BulkImportItem,
  BulkImportMode,
  BulkImportResult,
  BatchPriceAdjustmentParams,
  BatchPriceAdjustmentResult,
} from '../domain/catalog';
import { Order, CartLineItem, CartTotals, TenderPayment } from '../domain/order';
import { Shift, CashMovement, CashMovementType, TimeclockRecord } from '../domain/shift';
import { AuditLogEntry, AuditAction, AuditSeverity } from '../domain/audit';
import { OutboxItem } from '../domain/sync';
import { Money } from '../domain/money';

export interface LoginRequest {
  organizationSlug: string;
  storeCode: string;
  emailOrPin: string;
  passwordOrPin?: string;
  registerId: string;
}

export interface CheckoutRequest {
  idempotencyKey: string;
  storeId: string;
  registerId: string;
  cashierId: string;
  customer?: { id: string; name: string; phone: string; email: string };
  items: readonly CartLineItem[];
  totals: CartTotals;
  payments: readonly TenderPayment[];
  notes?: string;
  isOfflineSubmission?: boolean;
}

export interface CheckoutResponse {
  readonly success: boolean;
  readonly order: Order;
  readonly serverConfirmed: boolean;
  readonly message: string;
  readonly idempotencyCached?: boolean;
}

export interface IAuthApi {
  login(req: LoginRequest): Promise<SessionContext>;
  logout(): Promise<void>;
  verifySession(token: string): Promise<SessionContext | null>;
  getStores(orgSlug: string): Promise<readonly Store[]>;
}

export interface ICatalogApi {
  getCategories(storeId: string): Promise<readonly Category[]>;
  getProducts(storeId: string, categoryId?: string, search?: string): Promise<readonly Product[]>;
  getProductByBarcode(storeId: string, barcode: string): Promise<Product | null>;
  getInventoryLedger(storeId: string, productId?: string): Promise<readonly InventoryLedgerEntry[]>;
  adjustStock(
    storeId: string,
    productId: string,
    quantityDelta: number,
    reason: StockMovementReason,
    userId: string,
    notes?: string
  ): Promise<InventoryLedgerEntry>;
  bulkAdjustStock(
    storeId: string,
    productIds: readonly string[],
    quantityDelta: number,
    reason: StockMovementReason,
    userId: string,
    notes?: string
  ): Promise<readonly InventoryLedgerEntry[]>;
  bulkUpdatePricing(
    storeId: string,
    productIds: readonly string[],
    priceChangeType: 'set_amount' | 'percent_markup' | 'percent_discount',
    value: number,
    userId: string
  ): Promise<readonly Product[]>;
  batchPriceAdjustment(
    params: BatchPriceAdjustmentParams
  ): Promise<BatchPriceAdjustmentResult>;
  bulkImportProducts(
    storeId: string,
    items: readonly BulkImportItem[],
    mode: BulkImportMode,
    userId: string,
    notes?: string
  ): Promise<BulkImportResult>;
}

export interface RefundItemRestock {
  productId: string;
  quantity: number;
}

export interface IOrderApi {
  createOrder(req: CheckoutRequest): Promise<CheckoutResponse>;
  getOrders(storeId: string, limit?: number): Promise<readonly Order[]>;
  getOrderById(storeId: string, orderId: string): Promise<Order | null>;
  voidOrder(storeId: string, orderId: string, reason: string, authorizedByUserId: string): Promise<Order>;
  refundOrder(
    storeId: string,
    orderId: string,
    refundAmount: Money,
    reason: string,
    refundMethod: 'cash' | 'card' | 'qr_digital',
    restockItems: boolean,
    authorizedByUserId: string,
    authorizedByName: string,
    itemsToRestock?: readonly RefundItemRestock[]
  ): Promise<Order>;
}

export interface IShiftApi {
  getCurrentShift(storeId: string, registerId: string): Promise<Shift | null>;
  openShift(storeId: string, registerId: string, openingFloat: Money, cashier: User, idempotencyKey?: string): Promise<Shift>;
  closeShift(shiftId: string, actualCountedCash: Money, notes?: string, idempotencyKey?: string): Promise<Shift>;
  recordCashMovement(
    shiftId: string,
    type: CashMovementType,
    amount: Money,
    reason: string,
    userId: string
  ): Promise<CashMovement>;
  clockIn(pin: string, storeId: string): Promise<TimeclockRecord>;
  clockOut(pin: string, storeId: string): Promise<TimeclockRecord>;
  getTimeclockRecords(storeId: string): Promise<TimeclockRecord[]>;
}

export interface IAuditApi {
  recordEvent(
    storeId: string,
    registerId: string,
    userId: string,
    userName: string,
    action: AuditAction,
    severity: AuditSeverity,
    details: Record<string, unknown>
  ): Promise<AuditLogEntry>;
  getLogs(storeId: string, limit?: number): Promise<readonly AuditLogEntry[]>;
}

export interface ISyncApi {
  syncOutboxItem(item: OutboxItem): Promise<{ confirmedOrder: Order; syncedAt: string }>;
  ping(clientTimestamp?: number): Promise<{ serverTimestamp: string; roundTripLatencyMs: number; status: 'ok' | 'degraded' }>;
}
