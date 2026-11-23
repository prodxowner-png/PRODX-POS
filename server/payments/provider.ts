export type SupportedPaymentProvider = 'stripe';
export type PaymentProviderName = SupportedPaymentProvider | 'internal';

export const PAYMENT_STATUSES = [
  'pending',
  'authorized',
  'captured',
  'settled',
  'failed',
  'cancelled',
  'unknown',
  'voided',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const PAYMENT_STATUS_SET = new Set<string>(PAYMENT_STATUSES);

export const VALID_PAYMENT_STATUS_TRANSITIONS: Readonly<Record<PaymentStatus, ReadonlySet<PaymentStatus>>> = {
  pending: new Set<PaymentStatus>(['pending', 'authorized', 'captured', 'failed', 'cancelled', 'unknown']),
  authorized: new Set<PaymentStatus>(['authorized', 'captured', 'failed', 'cancelled', 'unknown', 'voided']),
  captured: new Set<PaymentStatus>(['captured', 'settled', 'voided']),
  settled: new Set<PaymentStatus>(['settled']),
  failed: new Set<PaymentStatus>(['failed']),
  cancelled: new Set<PaymentStatus>(['cancelled']),
  unknown: new Set<PaymentStatus>(['unknown', 'authorized', 'captured', 'failed', 'cancelled']),
  voided: new Set<PaymentStatus>(['voided']),
};

export const isValidPaymentStatus = (value: unknown): value is PaymentStatus =>
  typeof value === 'string' && PAYMENT_STATUS_SET.has(value);

export const isValidPaymentTransition = (from: PaymentStatus, to: PaymentStatus): boolean =>
  VALID_PAYMENT_STATUS_TRANSITIONS[from].has(to);

export class PaymentTransitionError extends Error {
  readonly code = 'PAYMENT_TRANSITION_INVALID';
  constructor(from: PaymentStatus, to: PaymentStatus) {
    super(`Invalid payment transition ${from} -> ${to}.`);
    this.name = 'PaymentTransitionError';
  }
}

export const assertValidPaymentTransition = (from: PaymentStatus, to: PaymentStatus): void => {
  if (!isValidPaymentTransition(from, to)) {
    throw new PaymentTransitionError(from, to);
  }
};

export type PaymentWebhookTransitionTarget = 'captured' | 'failed' | 'cancelled';

export type VerifiedWebhookEvent = {
  provider: SupportedPaymentProvider;
  eventId: string;
  eventType: string;
  createdAtUnix: number;
  payloadSha256: string;
  paymentStatusTransition: {
    to: PaymentWebhookTransitionTarget;
    providerReference: string;
    paymentId?: string;
    orderId?: string;
    storeId?: string;
    organizationId?: string;
    amountReceived?: bigint;
    currency?: string;
    failureCode?: string;
    failureReason?: string;
  } | null;
};

export type VerifyWebhookInput = {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
};

export interface PaymentProvider {
  readonly name: SupportedPaymentProvider;
  verifyWebhook(input: VerifyWebhookInput): VerifiedWebhookEvent;
}
