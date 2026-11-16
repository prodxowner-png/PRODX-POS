import type { CheckoutRequest } from '../../src/adapters/types';

export class CheckoutValidationError extends Error {
  readonly code = 'CHECKOUT_VALIDATION_FAILED';
}

type UnknownRecord = Record<string, unknown>;

// The checkout schema persists monetary values as NUMERIC(12,2) and quantities
// as PostgreSQL INTEGER. Reject values that JavaScript can represent but the
// authoritative schema cannot store before any database side effect.
const MAX_MINOR_UNITS = 999_999_999_999;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isMoney = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  return (
    typeof value.amountInCents === 'number' &&
    Number.isSafeInteger(value.amountInCents) &&
    value.amountInCents >= 0 &&
    value.amountInCents <= MAX_MINOR_UNITS &&
    typeof value.currency === 'string' &&
    /^[A-Z]{3}$/.test(value.currency)
  );
};

const isBasisPoints = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 10000;

const assertMoney = (value: unknown, field: string): void => {
  if (!isMoney(value)) {
    throw new CheckoutValidationError(
      `${field} must contain a safe non-negative integer minor-unit amount and a three-letter uppercase currency code.`,
    );
  }
};

const assertOptionalString = (record: UnknownRecord, field: string): void => {
  if (record[field] !== undefined && typeof record[field] !== 'string') {
    throw new CheckoutValidationError(`${field} must be a string when supplied.`);
  }
};

/**
 * Validate untrusted checkout JSON before discount inspection, fingerprinting,
 * BigInt conversion, database access, or any financial/idempotency side effect.
 */
export const assertCheckoutRequest: (value: unknown) => asserts value is CheckoutRequest = (value) => {
  if (!isRecord(value)) {
    throw new CheckoutValidationError('Checkout request body must be an object.');
  }

  for (const field of ['idempotencyKey', 'storeId', 'registerId', 'cashierId'] as const) {
    if (!isNonEmptyString(value[field])) {
      throw new CheckoutValidationError(`${field} is required.`);
    }
  }

  if (!Array.isArray(value.items) || value.items.length === 0) {
    throw new CheckoutValidationError('At least one checkout item is required.');
  }
  if (!Array.isArray(value.payments)) {
    throw new CheckoutValidationError('Checkout payments must be an array.');
  }
  if (!isRecord(value.totals)) {
    throw new CheckoutValidationError('Checkout totals must be an object.');
  }

  const totals = value.totals;
  for (const field of [
    'grossSubtotal',
    'itemDiscounts',
    'orderDiscount',
    'netSubtotal',
    'totalTax',
    'grandTotal',
  ] as const) {
    assertMoney(totals[field], `totals.${field}`);
  }
  if (
    typeof totals.totalItemsCount !== 'number' ||
    !Number.isSafeInteger(totals.totalItemsCount) ||
    totals.totalItemsCount < 0 ||
    totals.totalItemsCount > MAX_POSTGRES_INTEGER
  ) {
    throw new CheckoutValidationError('totals.totalItemsCount must be a non-negative safe integer.');
  }

  for (let index = 0; index < value.items.length; index += 1) {
    const item = value.items[index];
    if (!isRecord(item)) {
      throw new CheckoutValidationError(`items[${index}] must be an object.`);
    }
    if (!isNonEmptyString(item.lineId)) {
      throw new CheckoutValidationError(`items[${index}].lineId is required.`);
    }
    if (!isRecord(item.product) || !isNonEmptyString(item.product.id)) {
      throw new CheckoutValidationError(`items[${index}].product.id is required.`);
    }
    if (
      typeof item.quantity !== 'number' ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0 ||
      item.quantity > MAX_POSTGRES_INTEGER
    ) {
      throw new CheckoutValidationError(`items[${index}].quantity must be a positive safe integer.`);
    }
    if (!isBasisPoints(item.discountBps)) {
      throw new CheckoutValidationError(`items[${index}].discountBps must be an integer between 0 and 10000.`);
    }
    for (const field of ['unitPrice', 'lineSubtotal', 'lineTax', 'lineTotal'] as const) {
      assertMoney(item[field], `items[${index}].${field}`);
    }
  }

  const paymentIds = new Set<string>();
  for (let index = 0; index < value.payments.length; index += 1) {
    const payment = value.payments[index];
    if (!isRecord(payment)) {
      throw new CheckoutValidationError(`payments[${index}] must be an object.`);
    }
    if (!isNonEmptyString(payment.id)) {
      throw new CheckoutValidationError(`payments[${index}].id is required.`);
    }
    if (paymentIds.has(payment.id)) {
      throw new CheckoutValidationError('Payment identifiers must be unique within a checkout.');
    }
    paymentIds.add(payment.id);
    if (typeof payment.method !== 'string' || !['cash', 'card', 'qr_digital'].includes(payment.method)) {
      throw new CheckoutValidationError(`payments[${index}].method is unsupported.`);
    }
    assertMoney(payment.amount, `payments[${index}].amount`);
    if (payment.tenderedCash !== undefined) {
      assertMoney(payment.tenderedCash, `payments[${index}].tenderedCash`);
    }
    if (payment.changeGiven !== undefined) {
      assertMoney(payment.changeGiven, `payments[${index}].changeGiven`);
    }
    if (typeof payment.timestamp !== 'string' || Number.isNaN(Date.parse(payment.timestamp))) {
      throw new CheckoutValidationError(`payments[${index}].timestamp must be a valid date-time string.`);
    }
    for (const field of ['authCode', 'cardLastFour', 'terminalReference'] as const) {
      assertOptionalString(payment, field);
    }
  }

  if (value.orderDiscountBps !== undefined && !isBasisPoints(value.orderDiscountBps)) {
    throw new CheckoutValidationError('orderDiscountBps must be an integer between 0 and 10000.');
  }
  if (value.customer !== undefined) {
    if (!isRecord(value.customer)) {
      throw new CheckoutValidationError('customer must be an object when supplied.');
    }
    for (const field of ['id', 'name', 'phone', 'email'] as const) {
      if (typeof value.customer[field] !== 'string') {
        throw new CheckoutValidationError(`customer.${field} must be a string.`);
      }
    }
  }
  assertOptionalString(value, 'notes');
  if (value.isOfflineSubmission !== undefined && typeof value.isOfflineSubmission !== 'boolean') {
    throw new CheckoutValidationError('isOfflineSubmission must be a boolean when supplied.');
  }
};

export const isCheckoutRequest = (value: unknown): value is CheckoutRequest => {
  try {
    assertCheckoutRequest(value);
    return true;
  } catch {
    return false;
  }
};

export const hasCheckoutDiscount = (request: CheckoutRequest): boolean =>
  (request.orderDiscountBps ?? 0) > 0 ||
  request.items.some((item) => item.discountBps > 0);
