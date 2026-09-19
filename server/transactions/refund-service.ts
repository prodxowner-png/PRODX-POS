import crypto from 'node:crypto';
import type { Money } from '../../src/domain/money';
import type { RefundItemRestock } from '../../src/adapters/types';
import type { SqlQueryExecutor, TransactionalSqlExecutor } from '../db/transaction';
import { createSupervisorAuthorizationService, SupervisorAuthorizationError } from '../auth/supervisor-authorization';

type SupervisorAuthorizationDb = {
  query<T extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]): Promise<readonly T[]>;
};

const supervisorAuthorizationDb = (tx: SqlQueryExecutor): SupervisorAuthorizationDb => ({
  async query<T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) {
    const result = await tx.query<T>(sql, parameters);
    return result.rows;
  },
});

export class RefundValidationError extends Error { readonly code = 'REFUND_VALIDATION_FAILED'; }
export class RefundConflictError extends Error { readonly code = 'REFUND_CONFLICT'; }
export class RefundProviderUnavailableError extends Error { readonly code = 'REFUND_PROVIDER_UNAVAILABLE'; }

type RefundRequest = {
  storeId: string; orderId: string; refundAmount: Money; reason: string;
  refundMethod: 'cash' | 'card' | 'qr_digital'; authorizedByUserId: string;
  itemsToRestock?: readonly RefundItemRestock[]; idempotencyKey: string; supervisorAuthorizationToken?: string; requesterUserId?: string; requesterSessionId?: string;
};
type RefundResponse = {
  success: true; refundId: string; orderId: string;
  status: 'server_confirmed' | 'refunded'; refundedAmount: Money;
  message: string; idempotencyCached: boolean;
};

const toCents = (money: Money, field: string): bigint => {
  if (!Number.isSafeInteger(money.amountInCents) || money.amountInCents <= 0 || money.amountInCents > 999_999_999_999) throw new RefundValidationError(`${field} must be a positive integer minor-unit amount within the database money range.`);
  return BigInt(money.amountInCents);
};
const numeric = (cents: bigint): string => `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
// PostgreSQL ROUND for non-negative monetary cents: ties round up.
const roundDivide = (numerator: bigint, denominator: bigint): bigint =>
  (numerator + denominator / 2n) / denominator;
const dbCents = (value: unknown): bigint => {
  const text = String(value);
  const withDecimals = /^(\d+)\.(\d{2})$/.exec(text);
  if (withDecimals) return BigInt(withDecimals[1]) * 100n + BigInt(withDecimals[2]);
  const wholeOnly = /^(\d+)$/.exec(text);
  if (wholeOnly) return BigInt(wholeOnly[1]) * 100n;
  throw new RefundValidationError('Database monetary value is invalid.');
};
const normalizeRestockRequest = (items: readonly RefundItemRestock[]): readonly RefundItemRestock[] => {
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.productId || !Number.isInteger(item.quantity) || item.quantity <= 0 || seen.has(item.productId)) throw new RefundValidationError('Restock items must contain unique products with a positive integer quantity.');
    seen.add(item.productId);
  }
  return items;
};

export const createRefundService = (db: TransactionalSqlExecutor) => ({
  async refund(request: RefundRequest): Promise<RefundResponse> {
    if (!request.storeId || !request.orderId || !request.authorizedByUserId || !request.idempotencyKey.trim()) throw new RefundValidationError('Store, order, authorization and idempotency key are required.');
    const amount = toCents(request.refundAmount, 'refund amount');
    if (!/^[A-Z]{3}$/.test(request.refundAmount.currency)) throw new RefundValidationError('Refund currency must be a three-letter uppercase code.');
    if (!request.reason.trim()) throw new RefundValidationError('Refund reason is required.');
    if (request.refundMethod !== 'cash') throw new RefundProviderUnavailableError('Card and QR refunds require a configured payment-provider adapter; the server will fail closed until one is configured.');

    if (request.supervisorAuthorizationToken && (!request.requesterUserId || !request.requesterSessionId)) {
      throw new RefundValidationError('Supervisor authorization requires requester user and session binding.');
    }
    const requesterUserId = request.requesterUserId ?? request.authorizedByUserId;
    const restock = normalizeRestockRequest(request.itemsToRestock ?? []);
    const requestedItemsFingerprint = [...restock].map((item) => ({ productId: item.productId, quantity: item.quantity })).sort((a, b) => a.productId.localeCompare(b.productId));

    return db.transaction(async (tx) => {
      const existing = (await tx.query(`SELECT r.id, r.order_id, r.amount::text AS amount, r.method, r.reason,
          r.authorized_by_user_id, r.requester_user_id, r.currency, r.result_status AS status
        FROM prodx_refunds r JOIN prodx_orders o ON o.id = r.order_id AND o.store_id = r.store_id
        WHERE r.store_id=$1 AND r.idempotency_key=$2 LIMIT 1`, [request.storeId, request.idempotencyKey])).rows[0] as
        | { id: string; order_id: string; amount: string; method: string; reason: string; authorized_by_user_id: string; requester_user_id: string; currency: string; status: 'server_confirmed' | 'refunded' }
        | undefined;
      if (existing) {
        const isSameScalarRequest = existing.order_id === request.orderId && existing.method === request.refundMethod &&
          existing.reason === request.reason.trim() && existing.requester_user_id === requesterUserId &&
          existing.currency === request.refundAmount.currency && dbCents(existing.amount) === amount;
        if (!isSameScalarRequest) throw new RefundConflictError('This idempotency key was already used for a different refund request.');

        const existingItems = (await tx.query(`SELECT product_id, SUM(quantity)::int AS quantity FROM prodx_refund_items
          WHERE store_id=$1 AND refund_id=$2 GROUP BY product_id ORDER BY product_id`, [request.storeId, existing.id])).rows
          .map((row) => ({ productId: String(row.product_id), quantity: Number(row.quantity) }));
        const isSameItems = existingItems.length === requestedItemsFingerprint.length &&
          existingItems.every((row, index) => row.productId === requestedItemsFingerprint[index].productId && row.quantity === requestedItemsFingerprint[index].quantity);
        if (!isSameItems) throw new RefundConflictError('This idempotency key was already used for a different refund request.');

        return { success: true, refundId: existing.id, orderId: existing.order_id, status: existing.status,
          refundedAmount: { amountInCents: Number(dbCents(existing.amount)), currency: existing.currency },
          message: 'Refund already committed; returning the existing transaction.', idempotencyCached: true };
      }

      const order = (await tx.query(`SELECT * FROM prodx_orders WHERE id=$1 AND store_id=$2 FOR UPDATE`, [request.orderId, request.storeId])).rows[0] as any;
      if (!order) throw new RefundValidationError('Order was not found in the authenticated store.');

      let supervisorUserId = request.authorizedByUserId;
      if (request.supervisorAuthorizationToken && request.requesterUserId && request.requesterSessionId) {
        try {
          supervisorUserId = (await createSupervisorAuthorizationService(supervisorAuthorizationDb(tx)).consume({
            token: request.supervisorAuthorizationToken,
            organizationId: String(order.organization_id),
            storeId: request.storeId,
            requesterUserId: request.requesterUserId,
            requesterSessionId: request.requesterSessionId,
            action: 'refund',
            orderId: request.orderId,
          })).supervisorUserId;
        } catch (error) {
          if (error instanceof SupervisorAuthorizationError) {
            throw new RefundConflictError('Supervisor authorization is expired, already consumed, or not bound to this refund request.');
          }
          throw error;
        }
      }

      if (order.status !== 'server_confirmed') throw new RefundConflictError('Only server-confirmed sales can be refunded.');

      const membership = (await tx.query(`SELECT 1 FROM prodx_store_memberships
        WHERE organization_id=$1 AND store_id=$2 AND user_id=$3 AND active=true
        FOR UPDATE`, [order.organization_id, request.storeId, supervisorUserId])).rows[0];
      if (!membership) throw new RefundConflictError('The authorizing user is not an active member of the target store.');

      const currency = String(order.currency).trim();
      const recordedPayments = (await tx.query(`SELECT COALESCE(SUM(amount),0)::text AS amount,
          COUNT(*) FILTER (WHERE currency <> $3) AS mismatched_currency_count
        FROM prodx_payments
        WHERE store_id=$1 AND order_id=$2 AND status IN ('captured', 'settled')`, [request.storeId, request.orderId, currency])).rows[0] as { amount: string; mismatched_currency_count: string | number };
      if (Number(recordedPayments.mismatched_currency_count) > 0) throw new RefundConflictError('The order contains a payment recorded in a currency different from the order currency.');
      if (dbCents(recordedPayments.amount) < dbCents(order.grand_total_amount)) throw new RefundConflictError('The order does not have a fully recorded payment balance.');
      if (currency !== request.refundAmount.currency) throw new RefundValidationError('Refund currency does not match the order.');

      const alreadyRefunded = (await tx.query(`SELECT COALESCE(SUM(amount),0)::text AS amount FROM prodx_refunds WHERE store_id=$1 AND order_id=$2`, [request.storeId, request.orderId])).rows[0] as { amount: string };
      const refundedBefore = dbCents(alreadyRefunded.amount);
      const orderTotal = dbCents(order.grand_total_amount);
      if (refundedBefore + amount > orderTotal) throw new RefundConflictError('Refund amount exceeds the remaining refundable order balance.');
      const resultStatus: RefundResponse['status'] = refundedBefore + amount === orderTotal ? 'refunded' : 'server_confirmed';

      const shift = (await tx.query(`SELECT id FROM prodx_shifts WHERE id=$1 AND store_id=$2 AND status='open' FOR UPDATE`, [order.shift_id, request.storeId])).rows[0] as { id: string } | undefined;
      if (!shift) throw new RefundConflictError('The originating shift is not open; cash refund cannot be committed.');

      const refundId = crypto.randomUUID();
      const inserted = (await tx.query(`INSERT INTO prodx_refunds
        (id,organization_id,store_id,order_id,amount,currency,result_status,method,reason,authorized_by_user_id,requester_user_id,idempotency_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(store_id,idempotency_key) DO NOTHING
        RETURNING id, order_id, amount::text`, [
          refundId, order.organization_id, request.storeId, request.orderId, numeric(amount),
          currency, resultStatus, request.refundMethod, request.reason.trim(),
          supervisorUserId, requesterUserId, request.idempotencyKey,
        ])).rows[0];
      if (!inserted) {
        const concurrent = (await tx.query(`SELECT r.id, r.order_id, r.amount::text AS amount, r.method, r.reason,
            r.authorized_by_user_id, r.requester_user_id, r.currency, r.result_status AS status
          FROM prodx_refunds r JOIN prodx_orders o ON o.id = r.order_id AND o.store_id = r.store_id
          WHERE r.store_id=$1 AND r.idempotency_key=$2 LIMIT 1`, [request.storeId, request.idempotencyKey])).rows[0] as
          | { id: string; order_id: string; amount: string; method: string; reason: string; authorized_by_user_id: string; requester_user_id: string; currency: string; status: 'server_confirmed' | 'refunded' }
          | undefined;
        if (!concurrent) throw new RefundConflictError('Idempotency conflict could not be resolved.');
        const sameScalar = concurrent.order_id === request.orderId && concurrent.method === request.refundMethod &&
          concurrent.reason === request.reason.trim() && concurrent.requester_user_id === requesterUserId &&
          concurrent.currency === request.refundAmount.currency && dbCents(concurrent.amount) === amount;
        if (!sameScalar) throw new RefundConflictError('This idempotency key was already used for a different refund request.');
        const concurrentItems = (await tx.query(`SELECT product_id, SUM(quantity)::int AS quantity FROM prodx_refund_items
          WHERE store_id=$1 AND refund_id=$2 GROUP BY product_id ORDER BY product_id`, [request.storeId, concurrent.id])).rows
          .map((row) => ({ productId: String(row.product_id), quantity: Number(row.quantity) }));
        const sameItems = concurrentItems.length === requestedItemsFingerprint.length &&
          concurrentItems.every((row, index) => row.productId === requestedItemsFingerprint[index].productId && row.quantity === requestedItemsFingerprint[index].quantity);
        if (!sameItems) throw new RefundConflictError('This idempotency key was already used for a different refund request.');
        return {
          success: true, refundId: concurrent.id, orderId: concurrent.order_id, status: concurrent.status,
          refundedAmount: { amountInCents: Number(dbCents(concurrent.amount)), currency: concurrent.currency },
          message: 'Refund already committed; returning the existing transaction.', idempotencyCached: true,
        };
      }

      let restockAmountTotal = 0n;
      const restockAllocations: Array<{
        orderItemId: string;
        productId: string;
        quantity: number;
        amount: bigint;
      }> = [];

      for (const item of restock) {
        const orderItemRows = (await tx.query(`SELECT oi.id, oi.quantity, oi.line_total_amount::text AS line_total
          FROM prodx_order_items oi WHERE oi.store_id=$1 AND oi.order_id=$2 AND oi.product_id=$3 ORDER BY oi.id FOR UPDATE`,
          [request.storeId, request.orderId, item.productId])).rows as { id: string; quantity: number; line_total: string }[];
        if (orderItemRows.length === 0) throw new RefundValidationError(`Product ${item.productId} is not part of the order.`);

        let remaining = item.quantity;
        for (const orderItem of orderItemRows) {
          if (remaining === 0) break;
          const previous = (await tx.query(`SELECT COALESCE(SUM(quantity),0)::int AS quantity
            FROM prodx_refund_items WHERE store_id=$1 AND order_item_id=$2`,
            [request.storeId, orderItem.id])).rows[0] as { quantity: number };
          const previousQuantity = previous.quantity;
          const available = orderItem.quantity - previousQuantity;
          if (available <= 0) continue;

          const allocatedQuantity = Math.min(remaining, available);
          const totalLineCents = dbCents(orderItem.line_total);
          const cumulativeQuantity = previousQuantity + allocatedQuantity;
          const cumulativeAllocated = roundDivide(totalLineCents * BigInt(cumulativeQuantity), BigInt(orderItem.quantity));
          const previouslyAllocated = roundDivide(totalLineCents * BigInt(previousQuantity), BigInt(orderItem.quantity));
          const itemAmount = cumulativeAllocated - previouslyAllocated;

          restockAmountTotal += itemAmount;
          restockAllocations.push({ orderItemId: orderItem.id, productId: item.productId, quantity: allocatedQuantity, amount: itemAmount });
          remaining -= allocatedQuantity;
        }
        if (remaining > 0) throw new RefundConflictError(`Restock quantity exceeds the refundable quantity for product ${item.productId}.`);
      }

      if (restock.length > 0 && restockAmountTotal > amount) throw new RefundConflictError('The authoritative value of restocked items exceeds the cash refund amount.');

      for (const allocation of restockAllocations) {
        const stock = (await tx.query(`UPDATE prodx_products SET current_stock=current_stock+$1, updated_at=CURRENT_TIMESTAMP
          WHERE id=$2 AND store_id=$3 AND active=true RETURNING current_stock`,
          [allocation.quantity, allocation.productId, request.storeId])).rows[0] as { current_stock: number } | undefined;
        if (!stock) throw new RefundConflictError(`Product ${allocation.productId} is unavailable for restock.`);

        await tx.query(`INSERT INTO prodx_refund_items
          (id,organization_id,store_id,refund_id,order_id,order_item_id,product_id,quantity,amount)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [crypto.randomUUID(), order.organization_id, request.storeId, refundId, request.orderId, allocation.orderItemId, allocation.productId, allocation.quantity, numeric(allocation.amount)]);
        await tx.query(`INSERT INTO prodx_inventory_ledger
          (id,organization_id,store_id,product_id,quantity_delta,resulting_stock,reason,reference_id,performed_by_user_id)
          VALUES($1,$2,$3,$4,$5,$6,'refund_restock',$7,$8)`,
          [crypto.randomUUID(), order.organization_id, request.storeId, allocation.productId, allocation.quantity, stock.current_stock, refundId, supervisorUserId]);
      }
      await tx.query(`INSERT INTO prodx_cash_movements
        (id,organization_id,store_id,shift_id,refund_id,type,amount,reason,performed_by_user_id,currency)
        VALUES($1,$2,$3,$4,$5,'cash_refund',$6,$7,$8,$9)`,
        [crypto.randomUUID(), order.organization_id, request.storeId, shift.id, refundId, numeric(amount),
          `Refund for Order #${order.order_number}: ${request.reason.trim()}`, supervisorUserId, currency]);

      const status = resultStatus;
      await tx.query(`UPDATE prodx_orders SET status=$1 WHERE id=$2 AND store_id=$3`, [status, request.orderId, request.storeId]);
      await tx.query(`INSERT INTO prodx_audit_log
        (id,organization_id,store_id,register_id,user_id,action,severity,details)
        VALUES($1,$2,$3,$4,$5,'order_refund_committed','critical',$6::jsonb)`,
        [crypto.randomUUID(), order.organization_id, request.storeId, order.register_id, requesterUserId,
          JSON.stringify({ refundId, orderId: request.orderId, amount: numeric(amount), method: request.refundMethod, reason: request.reason.trim(), idempotencyKey: request.idempotencyKey, supervisorUserId, requesterUserId })]);
      return { success: true, refundId, orderId: request.orderId, status,
        refundedAmount: { amountInCents: Number(amount), currency }, message: 'Refund committed atomically with cash and inventory ledger entries.', idempotencyCached: false };
    });
  },
});