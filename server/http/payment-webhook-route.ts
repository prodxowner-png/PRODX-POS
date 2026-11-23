import type { Express, Request, Response } from 'express';
import type { TransactionalSqlExecutor } from '../db/transaction.ts';
import {
  isValidPaymentStatus,
  isValidPaymentTransition,
  type PaymentStatus,
} from '../payments/provider.ts';
import {
  DEFAULT_STRIPE_WEBHOOK_TOLERANCE_SECONDS,
  stripePaymentProvider,
  StripeWebhookVerificationError,
} from '../payments/stripe-webhook.ts';

export type PaymentWebhookRouteOptions = {
  webhookSecret?: string;
  toleranceSeconds?: number;
  nowSeconds?: () => number;
};

type WebhookRecordRow = {
  event_row_id: string;
  inserted: boolean;
};

type WebhookTargetRow = {
  organization_id: string;
  store_id: string;
  order_id: string;
  payment_id: string;
  status: string;
  provider: string;
  provider_reference: string | null;
};

type LockedPaymentRow = {
  id: string;
  order_id: string;
  status: string;
  amount: string;
  currency: string;
  provider: string;
  provider_reference: string | null;
};

const parseDbAmountToMinorUnits = (value: unknown): bigint | null => {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const whole = BigInt(match[1]);
  const fractional = BigInt((match[2] ?? '').padEnd(2, '0'));
  return whole * 100n + fractional;
};

export const registerPaymentWebhookRoute = (
  app: Express,
  db: TransactionalSqlExecutor,
  options: PaymentWebhookRouteOptions = {},
): void => {
  app.post('/api/v1/webhooks/stripe', async (request: Request, response: Response, next) => {
    try {
    const secret = (options.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();
    if (!secret) {
      response.status(503).json({
        error: {
          code: 'PAYMENT_WEBHOOK_NOT_CONFIGURED',
          message: 'Stripe payment webhook verification is not configured.',
          requestId: request.id,
        },
      });
      return;
    }

    const rawBody = request.rawBody;
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      response.status(400).json({
        error: {
          code: 'WEBHOOK_PAYLOAD_INVALID',
          message: 'Raw request body is required for Stripe webhook verification.',
          requestId: request.id,
        },
      });
      return;
    }

    // Verify cryptographic signature and replay window strictly BEFORE opening
    // any PostgreSQL transaction or performing database I/O.
    let verifiedEvent;
    try {
      verifiedEvent = stripePaymentProvider.verifyWebhook({
        rawBody,
        signatureHeader: request.header('stripe-signature'),
        secret,
        nowSeconds: options.nowSeconds ? options.nowSeconds() : undefined,
        toleranceSeconds: options.toleranceSeconds ?? DEFAULT_STRIPE_WEBHOOK_TOLERANCE_SECONDS,
      });
    } catch (error) {
      if (error instanceof StripeWebhookVerificationError) {
        response.status(error.httpStatus).json({
          error: {
            code: error.code,
            message: error.message,
            requestId: request.id,
          },
        });
        return;
      }
      throw error;
    }

    const outcome = await db.transaction(async (tx) => {
      const recorded = (await tx.query<WebhookRecordRow>(
        `SELECT event_row_id, inserted
           FROM public.prodx_payment_webhook_record_event($1, $2, $3, $4, $5)`,
        [
          verifiedEvent.provider,
          verifiedEvent.eventId,
          verifiedEvent.eventType,
          verifiedEvent.payloadSha256,
          verifiedEvent.paymentStatusTransition?.providerReference ?? null,
        ],
      )).rows[0];

      if (!recorded) {
        throw new Error('Failed to record verified Stripe webhook event.');
      }

      if (!recorded.inserted) {
        return {
          status: 200 as const,
          body: {
            received: true,
            duplicate: true,
            eventId: verifiedEvent.eventId,
          },
        };
      }

      const transition = verifiedEvent.paymentStatusTransition;
      if (!transition) {
        await tx.query(
          `SELECT public.prodx_payment_webhook_update_status($1, 'ignored', NULL, NULL, NULL, $2)`,
          [recorded.event_row_id, 'unsupported_event_type'],
        );
        return {
          status: 200 as const,
          body: {
            received: true,
            duplicate: false,
            ignored: true,
            eventId: verifiedEvent.eventId,
          },
        };
      }

      const target = (await tx.query<WebhookTargetRow>(
        `SELECT organization_id, store_id, order_id, payment_id, status, provider, provider_reference
           FROM public.prodx_payment_webhook_resolve_target($1, $2, $3)`,
        [verifiedEvent.provider, transition.providerReference, transition.paymentId ?? null],
      )).rows[0];

      if (!target) {
        await tx.query(
          `SELECT public.prodx_payment_webhook_update_status($1, 'ignored', NULL, NULL, NULL, $2)`,
          [recorded.event_row_id, 'payment_not_found'],
        );
        return {
          status: 200 as const,
          body: {
            received: true,
            duplicate: false,
            ignored: true,
            reason: 'payment_not_found',
            eventId: verifiedEvent.eventId,
          },
        };
      }

      if (
        (transition.organizationId && transition.organizationId !== target.organization_id)
        || (transition.storeId && transition.storeId !== target.store_id)
        || (transition.orderId && transition.orderId !== target.order_id)
        || (transition.paymentId && transition.paymentId !== target.payment_id)
      ) {
        await tx.query(
          `SELECT public.prodx_payment_webhook_update_status($1, 'rejected', $2, $3, $4, $5)`,
          [
            recorded.event_row_id,
            target.organization_id,
            target.store_id,
            target.payment_id,
            'tenant_scope_mismatch',
          ],
        );
        return {
          status: 409 as const,
          body: {
            error: {
              code: 'PAYMENT_WEBHOOK_TENANT_MISMATCH',
              message: 'Webhook metadata does not match the payment tenant scope.',
              requestId: request.id,
            },
          },
        };
      }

      // Bind transaction-local tenant context so all downstream payment, attempt,
      // and audit queries execute strictly under PostgreSQL RLS for this tenant.
      await tx.query(
        `SELECT set_config('app.organization_id', $1, true),
                set_config('app.store_id', $2, true)`,
        [target.organization_id, target.store_id],
      );

      const lockedPayment = (await tx.query<LockedPaymentRow>(
        `SELECT id, order_id, status, amount, currency, provider, provider_reference
           FROM public.prodx_payments
          WHERE id = $1 AND store_id = $2 AND organization_id = $3
          FOR UPDATE`,
        [target.payment_id, target.store_id, target.organization_id],
      )).rows[0];

      if (!lockedPayment || !isValidPaymentStatus(lockedPayment.status)) {
        await tx.query(
          `SELECT public.prodx_payment_webhook_update_status($1, 'rejected', $2, $3, $4, $5)`,
          [
            recorded.event_row_id,
            target.organization_id,
            target.store_id,
            target.payment_id,
            'payment_unavailable_under_tenant_rls',
          ],
        );
        return {
          status: 409 as const,
          body: {
            error: {
              code: 'PAYMENT_LIFECYCLE_CONFLICT',
              message: 'Payment could not be locked within tenant scope.',
              requestId: request.id,
            },
          },
        };
      }

      const currentStatus: PaymentStatus = lockedPayment.status;
      if (!isValidPaymentTransition(currentStatus, transition.to)) {
        const reason = `Invalid payment transition ${currentStatus} -> ${transition.to}.`;
        await tx.query(
          `SELECT public.prodx_payment_webhook_update_status($1, 'rejected', $2, $3, $4, $5)`,
          [
            recorded.event_row_id,
            target.organization_id,
            target.store_id,
            target.payment_id,
            reason,
          ],
        );
        return {
          status: 409 as const,
          body: {
            error: {
              code: 'PAYMENT_LIFECYCLE_CONFLICT',
              message: reason,
              requestId: request.id,
            },
          },
        };
      }

      if (transition.to === 'captured') {
        const expectedCurrency = lockedPayment.currency.trim().toUpperCase();
        const actualCurrency = transition.currency?.trim().toUpperCase();
        if (!actualCurrency || actualCurrency !== expectedCurrency) {
          const reason = actualCurrency
            ? `Currency mismatch: expected ${expectedCurrency}, received ${actualCurrency}.`
            : `Missing currency on payment_intent.succeeded (expected ${expectedCurrency}).`;
          await tx.query(
            `SELECT public.prodx_payment_webhook_update_status($1, 'rejected', $2, $3, $4, $5)`,
            [
              recorded.event_row_id,
              target.organization_id,
              target.store_id,
              target.payment_id,
              reason,
            ],
          );
          return {
            status: 409 as const,
            body: {
              error: {
                code: 'PAYMENT_WEBHOOK_CURRENCY_MISMATCH',
                message: reason,
                requestId: request.id,
              },
            },
          };
        }

        const expectedMinorUnits = parseDbAmountToMinorUnits(lockedPayment.amount);
        if (
          expectedMinorUnits === null
          || transition.amountReceived === undefined
          || transition.amountReceived !== expectedMinorUnits
        ) {
          const reason = transition.amountReceived === undefined
            ? `Missing amount_received/amount on payment_intent.succeeded (expected ${expectedMinorUnits?.toString() ?? 'valid amount'} minor units).`
            : `Amount mismatch: expected ${expectedMinorUnits?.toString() ?? 'valid amount'} minor units, received ${transition.amountReceived.toString()} minor units.`;
          await tx.query(
            `SELECT public.prodx_payment_webhook_update_status($1, 'rejected', $2, $3, $4, $5)`,
            [
              recorded.event_row_id,
              target.organization_id,
              target.store_id,
              target.payment_id,
              reason,
            ],
          );
          return {
            status: 409 as const,
            body: {
              error: {
                code: 'PAYMENT_WEBHOOK_AMOUNT_MISMATCH',
                message: reason,
                requestId: request.id,
              },
            },
          };
        }
      }

      const attemptIdempotencyKey = `webhook:${verifiedEvent.provider}:${verifiedEvent.eventId}`;

      await tx.query(
        `UPDATE public.prodx_payments
            SET status = $1,
                provider = $2,
                provider_reference = COALESCE($3, provider_reference),
                captured_at = CASE WHEN $1 = 'captured' THEN COALESCE(captured_at, CURRENT_TIMESTAMP) ELSE captured_at END,
                failure_code = $4,
                failure_reason = $5
          WHERE id = $6 AND store_id = $7 AND organization_id = $8`,
        [
          transition.to,
          verifiedEvent.provider,
          transition.providerReference,
          transition.failureCode ?? null,
          transition.failureReason ?? null,
          target.payment_id,
          target.store_id,
          target.organization_id,
        ],
      );

      await tx.query(
        `INSERT INTO public.prodx_payment_attempts (
           id, organization_id, store_id, order_id, payment_id,
           idempotency_key, provider, method, status, amount, currency,
           provider_reference, failure_code, failure_reason
         )
         SELECT gen_random_uuid(), p.organization_id, p.store_id, p.order_id, p.id,
                $1, $2, p.method, $3, p.amount, p.currency,
                $4, $5, $6
           FROM public.prodx_payments p
          WHERE p.id = $7 AND p.store_id = $8 AND p.organization_id = $9
         ON CONFLICT (store_id, idempotency_key) DO NOTHING`,
        [
          attemptIdempotencyKey,
          verifiedEvent.provider,
          transition.to,
          transition.providerReference,
          transition.failureCode ?? null,
          transition.failureReason ?? null,
          target.payment_id,
          target.store_id,
          target.organization_id,
        ],
      );

      await tx.query(
        `INSERT INTO public.prodx_audit_log (
           id, organization_id, store_id, register_id, user_id,
           action, severity, details, source_event_key
         )
         SELECT gen_random_uuid(), o.organization_id, o.store_id, o.register_id, o.cashier_id,
                'payment_webhook_transition', 'info', $1::jsonb, $2
           FROM public.prodx_orders o
          WHERE o.id = $3 AND o.store_id = $4 AND o.organization_id = $5
         ON CONFLICT (organization_id, store_id, source_event_key) WHERE source_event_key IS NOT NULL DO NOTHING`,
        [
          JSON.stringify({
            provider: verifiedEvent.provider,
            providerEventId: verifiedEvent.eventId,
            eventType: verifiedEvent.eventType,
            orderId: target.order_id,
            paymentId: target.payment_id,
            fromStatus: currentStatus,
            toStatus: transition.to,
            providerReference: transition.providerReference,
            payloadSha256: verifiedEvent.payloadSha256,
          }),
          attemptIdempotencyKey,
          target.order_id,
          target.store_id,
          target.organization_id,
        ],
      );

      await tx.query(
        `SELECT public.prodx_payment_webhook_update_status($1, 'processed', $2, $3, $4, NULL)`,
        [recorded.event_row_id, target.organization_id, target.store_id, target.payment_id],
      );

      return {
        status: 200 as const,
        body: {
          received: true,
          duplicate: false,
          eventId: verifiedEvent.eventId,
          paymentId: target.payment_id,
          status: transition.to,
        },
      };
    });

    response.status(outcome.status).json(outcome.body);
    } catch (error) {
      next(error);
    }
  });
};
