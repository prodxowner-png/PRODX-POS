import crypto from 'node:crypto';
import type {
  PaymentProvider,
  PaymentWebhookTransitionTarget,
  VerifiedWebhookEvent,
  VerifyWebhookInput,
} from './provider.ts';

export const DEFAULT_STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;

export type StripeWebhookVerificationErrorCode =
  | 'WEBHOOK_SIGNATURE_MISSING'
  | 'WEBHOOK_SIGNATURE_MALFORMED'
  | 'WEBHOOK_SIGNATURE_EXPIRED'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'WEBHOOK_PAYLOAD_INVALID';

export class StripeWebhookVerificationError extends Error {
  readonly code: StripeWebhookVerificationErrorCode;
  readonly httpStatus: 400 | 401;

  constructor(code: StripeWebhookVerificationErrorCode, message: string) {
    super(message);
    this.name = 'StripeWebhookVerificationError';
    this.code = code;
    this.httpStatus = code === 'WEBHOOK_SIGNATURE_EXPIRED' || code === 'WEBHOOK_SIGNATURE_INVALID' ? 401 : 400;
  }
}

type ParsedStripeSignature = {
  timestamp: number;
  v1Signatures: string[];
};

const parseStripeSignatureHeader = (header: string | undefined): ParsedStripeSignature => {
  if (!header || header.trim().length === 0) {
    throw new StripeWebhookVerificationError('WEBHOOK_SIGNATURE_MISSING', 'Missing Stripe-Signature header.');
  }

  let timestampRaw: string | null = null;
  const v1Signatures: string[] = [];

  for (const rawPart of header.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) {
      throw new StripeWebhookVerificationError('WEBHOOK_SIGNATURE_MALFORMED', 'Malformed Stripe-Signature header.');
    }
    const key = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (key === 't') {
      if (timestampRaw !== null || !/^\d+$/.test(value)) {
        throw new StripeWebhookVerificationError('WEBHOOK_SIGNATURE_MALFORMED', 'Invalid timestamp in Stripe-Signature header.');
      }
      timestampRaw = value;
    } else if (key === 'v1') {
      if (!/^[0-9a-f]{64}$/i.test(value)) {
        throw new StripeWebhookVerificationError('WEBHOOK_SIGNATURE_MALFORMED', 'Invalid v1 signature format in Stripe-Signature header.');
      }
      v1Signatures.push(value.toLowerCase());
    }
  }

  if (timestampRaw === null || v1Signatures.length === 0) {
    throw new StripeWebhookVerificationError('WEBHOOK_SIGNATURE_MALFORMED', 'Stripe-Signature header must include t and v1 values.');
  }

  const timestamp = Number.parseInt(timestampRaw, 10);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new StripeWebhookVerificationError('WEBHOOK_SIGNATURE_MALFORMED', 'Invalid timestamp in Stripe-Signature header.');
  }

  return { timestamp, v1Signatures };
};

const computeStripeHmac = (timestamp: number, rawBody: Buffer, secret: string): Buffer => {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${timestamp}.`, 'utf8');
  hmac.update(rawBody);
  return hmac.digest();
};

export const signStripeWebhookPayload = (
  rawBody: Buffer | string,
  secret: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): string => {
  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const signature = computeStripeHmac(timestampSeconds, bodyBuffer, secret).toString('hex');
  return `t=${timestampSeconds},v1=${signature}`;
};

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const optionalUuid = (value: unknown): string | undefined => {
  const str = nonEmptyString(value);
  return str && UUID_REGEX.test(str) ? str : undefined;
};

const EVENT_TRANSITION_MAP: Readonly<Record<string, PaymentWebhookTransitionTarget>> = {
  'payment_intent.succeeded': 'captured',
  'payment_intent.payment_failed': 'failed',
  'payment_intent.canceled': 'cancelled',
};

export const verifyStripeWebhook = (input: VerifyWebhookInput): VerifiedWebhookEvent => {
  const { rawBody, signatureHeader, secret } = input;
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    throw new StripeWebhookVerificationError('WEBHOOK_PAYLOAD_INVALID', 'Raw webhook payload buffer is required.');
  }
  if (!secret || secret.trim().length === 0) {
    throw new StripeWebhookVerificationError('WEBHOOK_SIGNATURE_INVALID', 'Webhook secret is not configured.');
  }

  const parsed = parseStripeSignatureHeader(signatureHeader);
  const toleranceSeconds = input.toleranceSeconds ?? DEFAULT_STRIPE_WEBHOOK_TOLERANCE_SECONDS;
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) {
    throw new StripeWebhookVerificationError(
      'WEBHOOK_SIGNATURE_EXPIRED',
      'Stripe-Signature timestamp is outside the allowed replay tolerance window.',
    );
  }

  const expectedDigest = computeStripeHmac(parsed.timestamp, rawBody, secret);
  const signatureMatched = parsed.v1Signatures.some((candidateHex) => {
    const candidateDigest = Buffer.from(candidateHex, 'hex');
    return candidateDigest.length === expectedDigest.length && crypto.timingSafeEqual(expectedDigest, candidateDigest);
  });

  if (!signatureMatched) {
    throw new StripeWebhookVerificationError('WEBHOOK_SIGNATURE_INVALID', 'Stripe-Signature verification failed.');
  }

  const payloadSha256 = crypto.createHash('sha256').update(rawBody).digest('hex');

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new StripeWebhookVerificationError('WEBHOOK_PAYLOAD_INVALID', 'Webhook body must be valid JSON.');
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new StripeWebhookVerificationError('WEBHOOK_PAYLOAD_INVALID', 'Webhook payload must be a JSON object.');
  }

  const eventObj = payload as Record<string, unknown>;
  const eventId = nonEmptyString(eventObj.id);
  const eventType = nonEmptyString(eventObj.type);
  const data = eventObj.data && typeof eventObj.data === 'object' && !Array.isArray(eventObj.data)
    ? (eventObj.data as Record<string, unknown>)
    : null;
  const dataObject = data?.object && typeof data.object === 'object' && !Array.isArray(data.object)
    ? (data.object as Record<string, unknown>)
    : null;

  if (!eventId || !eventType || !dataObject) {
    throw new StripeWebhookVerificationError('WEBHOOK_PAYLOAD_INVALID', 'Stripe event payload is missing id, type, or data.object.');
  }

  const transitionTarget = EVENT_TRANSITION_MAP[eventType];
  let paymentStatusTransition: VerifiedWebhookEvent['paymentStatusTransition'] = null;

  if (transitionTarget) {
    const providerReference = nonEmptyString(dataObject.id);
    if (!providerReference) {
      throw new StripeWebhookVerificationError('WEBHOOK_PAYLOAD_INVALID', 'Stripe payment_intent object is missing id.');
    }
    const metadata = dataObject.metadata && typeof dataObject.metadata === 'object' && !Array.isArray(dataObject.metadata)
      ? (dataObject.metadata as Record<string, unknown>)
      : {};
    const lastPaymentError = dataObject.last_payment_error && typeof dataObject.last_payment_error === 'object' && !Array.isArray(dataObject.last_payment_error)
      ? (dataObject.last_payment_error as Record<string, unknown>)
      : null;

    const failureCode = transitionTarget === 'failed'
      ? nonEmptyString(lastPaymentError?.code) ?? nonEmptyString(lastPaymentError?.decline_code)
      : undefined;
    const failureReason = transitionTarget === 'failed'
      ? nonEmptyString(lastPaymentError?.message)
      : transitionTarget === 'cancelled'
        ? nonEmptyString(dataObject.cancellation_reason)
        : undefined;

    const rawAmount = dataObject.amount_received !== undefined && dataObject.amount_received !== null
      ? dataObject.amount_received
      : dataObject.amount;
    const amountReceived = typeof rawAmount === 'number' && Number.isSafeInteger(rawAmount) && rawAmount >= 0
      ? BigInt(rawAmount)
      : undefined;
    const currencyRaw = nonEmptyString(dataObject.currency);
    const currency = currencyRaw ? currencyRaw.toUpperCase() : undefined;

    paymentStatusTransition = {
      to: transitionTarget,
      providerReference,
      paymentId: optionalUuid(metadata.paymentId ?? metadata.payment_id),
      orderId: optionalUuid(metadata.orderId ?? metadata.order_id),
      storeId: optionalUuid(metadata.storeId ?? metadata.store_id),
      organizationId: optionalUuid(metadata.organizationId ?? metadata.organization_id),
      amountReceived,
      currency,
      failureCode,
      failureReason,
    };
  }

  return {
    provider: 'stripe',
    eventId,
    eventType,
    createdAtUnix: parsed.timestamp,
    payloadSha256,
    paymentStatusTransition,
  };
};

export const stripePaymentProvider: PaymentProvider = {
  name: 'stripe',
  verifyWebhook: verifyStripeWebhook,
};
