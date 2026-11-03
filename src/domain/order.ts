/**
 * PRODX POS Domain - Orders, Cart & Financial Totals Module
 * 
 * Invariants:
 * 1. Decimal-safe monetary arithmetic across all line items and order totals.
 * 2. Strict distinction between 'server_confirmed' and 'pending_sync_offline' states.
 * 3. Authoritative idempotency key per transaction.
 */

import {
  Money,
  createMoney,
  addMoney,
  subtractMoney,
  multiplyMoney,
  calculateBasisPoints,
  ZERO_USD,
} from './money';
import { Product } from './catalog';

export type PaymentMethod = 'cash' | 'card' | 'qr_digital';

export type TransactionStatus =
  | 'draft'
  | 'authorizing'
  | 'server_confirmed'
  | 'pending_sync_offline'
  | 'failed'
  | 'voided'
  | 'refunded';

export interface Customer {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly loyaltyTier: 'Bronze' | 'Silver' | 'Gold' | 'VIP';
  readonly loyaltyPoints: number;
}

export interface CartLineItem {
  readonly lineId: string;
  readonly product: Product;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly discountBps: number; // Item discount (e.g. 1000 = 10%)
  readonly lineSubtotal: Money; // (unitPrice * qty) - lineDiscount
  readonly lineTax: Money;
  readonly lineTotal: Money;
}

export interface CartTotals {
  readonly grossSubtotal: Money;
  readonly itemDiscounts: Money;
  readonly orderDiscount: Money;
  readonly netSubtotal: Money;
  readonly totalTax: Money;
  readonly grandTotal: Money;
  readonly totalItemsCount: number;
}

export interface TenderPayment {
  readonly id: string;
  readonly method: PaymentMethod;
  readonly amount: Money;
  readonly tenderedCash?: Money;
  readonly changeGiven?: Money;
  readonly authCode?: string;
  readonly cardLastFour?: string;
  readonly terminalReference?: string;
  readonly timestamp: string;
}

export interface Order {
  readonly id: string;
  readonly orderNumber: string; // e.g. ORD-20260903-0104
  readonly idempotencyKey: string;
  readonly storeId: string;
  readonly registerId: string;
  readonly cashierId: string;
  readonly cashierName: string;
  readonly customer?: Customer;
  readonly items: readonly CartLineItem[];
  readonly totals: CartTotals;
  readonly payments: readonly TenderPayment[];
  readonly status: TransactionStatus;
  readonly serverCommittedAt?: string; // Only present if server_confirmed
  readonly createdAt: string; // ISO 8601 UTC
  readonly notes?: string;
  readonly offlineOutboxId?: string;
}

const roundDivide = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator <= 0n) throw new Error('Denominator must be positive');
  const sign = numerator < 0n ? -1n : 1n;
  const absNum = numerator < 0n ? -numerator : numerator;
  return sign * ((absNum + denominator / 2n) / denominator);
};

/**
 * Deterministically computes cart line item totals using exact BigInt arithmetic.
 */
export function calculateLineItem(
  product: Product,
  quantity: number,
  discountBps = 0,
  overriddenUnitPrice?: Money,
  existingLineId?: string
): CartLineItem {
  if (quantity <= 0) {
    throw new Error(`[Cart] Quantity must be greater than 0, received: ${quantity}`);
  }

  const basePrice = overriddenUnitPrice || product.price;
  const rawSubtotal = multiplyMoney(basePrice, quantity);
  const discountAmount = calculateBasisPoints(rawSubtotal, discountBps);
  const discountedSubtotal = subtractMoney(rawSubtotal, discountAmount); // Inclusive final amount

  const taxBps = BigInt(Math.trunc(product.taxRateBps));
  const taxCents = taxBps > 0n
    ? Number(roundDivide(BigInt(discountedSubtotal.amountInCents) * taxBps, 10000n + taxBps))
    : 0;
  const lineTax = createMoney(taxCents, discountedSubtotal.currency);
  const netSubtotal = subtractMoney(discountedSubtotal, lineTax); // Pre-tax taxable base

  return {
    lineId: existingLineId || `${product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    product,
    quantity,
    unitPrice: basePrice,
    discountBps,
    lineSubtotal: netSubtotal,
    lineTax,
    lineTotal: discountedSubtotal,
  };
}

/**
 * Deterministically aggregates cart totals using exact BigInt arithmetic.
 */
export function computeCartTotals(
  items: readonly CartLineItem[],
  orderDiscountBps = 0,
  baseCurrency = 'THB'
): CartTotals {
  if (items.length === 0) {
    const zero = createMoney(0, baseCurrency);
    return {
      grossSubtotal: zero,
      itemDiscounts: zero,
      orderDiscount: zero,
      netSubtotal: zero,
      totalTax: zero,
      grandTotal: zero,
      totalItemsCount: 0,
    };
  }

  const currency = items[0].unitPrice.currency;
  const zero = createMoney(0, currency);

  let grossSubtotal = zero;
  let itemDiscounts = zero;
  let netSubtotal = zero;
  let totalTax = zero;
  let totalItemsCount = 0;

  for (const item of items) {
    if (item.unitPrice.currency !== currency) {
      throw new Error(`[Cart] Currency mismatch in cart items: ${currency} vs ${item.unitPrice.currency}`);
    }
    const itemGross = multiplyMoney(item.unitPrice, item.quantity);
    const itemDisc = calculateBasisPoints(itemGross, item.discountBps);

    grossSubtotal = addMoney(grossSubtotal, itemGross);
    itemDiscounts = addMoney(itemDiscounts, itemDisc);
    netSubtotal = addMoney(netSubtotal, item.lineSubtotal);
    totalTax = addMoney(totalTax, item.lineTax);
    totalItemsCount += item.quantity;
  }

  const preOrderDiscountSubtotal = subtractMoney(grossSubtotal, itemDiscounts);
  const orderDiscount = calculateBasisPoints(preOrderDiscountSubtotal, orderDiscountBps);
  const grandTotal = subtractMoney(preOrderDiscountSubtotal, orderDiscount);

  // Proportional scaling for order discounts using exact BigInt division
  const adjustedNetCents = preOrderDiscountSubtotal.amountInCents > 0
    ? Number(
        roundDivide(
          BigInt(netSubtotal.amountInCents) * BigInt(grandTotal.amountInCents),
          BigInt(preOrderDiscountSubtotal.amountInCents)
        )
      )
    : 0;
  // Invariant: netSubtotal + totalTax must exactly equal grandTotal to prevent 1-cent discrepancies
  const adjustedTaxCents = grandTotal.amountInCents - adjustedNetCents;

  return {
    grossSubtotal: createMoney(grossSubtotal.amountInCents, currency),
    itemDiscounts: createMoney(itemDiscounts.amountInCents, currency),
    orderDiscount: createMoney(orderDiscount.amountInCents, currency),
    netSubtotal: createMoney(adjustedNetCents, currency),
    totalTax: createMoney(adjustedTaxCents, currency),
    grandTotal: createMoney(grandTotal.amountInCents, currency),
    totalItemsCount,
  };
}
