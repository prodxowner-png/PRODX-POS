import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { CheckoutRequest } from '../../src/adapters/types';
import {
  createSupervisorAuthorizationService,
  SupervisorAuthorizationError,
} from '../auth/supervisor-authorization';
import type { TransactionalSqlExecutor } from '../db/transaction';
import { createSupabaseTokenVerifier, type SupabaseTokenVerifier } from '../auth/session';
import { assertCheckoutRequest, hasCheckoutDiscount } from '../transactions/checkout-validation';
import { checkoutAuthorizationFingerprint } from '../transactions/checkout-service';

type Body = {
  action: 'refund' | 'void' | 'discount';
  orderId?: string;
  checkout?: CheckoutRequest;
  supervisorUsername?: string;
  supervisorUserId?: string;
  supervisorSecret?: string;
  supervisorAccessToken?: string;
};

const valid = (value: unknown): value is Body => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (!['refund', 'void', 'discount'].includes(String(body.action)) ||
      (typeof body.supervisorUsername !== 'string' && typeof body.supervisorUserId !== 'string') ||
      !((typeof body.supervisorSecret === 'string' && body.supervisorSecret.length > 0) || (typeof body.supervisorAccessToken === 'string' && body.supervisorAccessToken.length > 0)) ||
      (typeof body.supervisorAccessToken === 'string' && typeof body.supervisorUserId !== 'string')) return false;
  if (body.action === 'discount') {
    if (!body.checkout || typeof body.checkout !== 'object' || Array.isArray(body.checkout)) return false;
    try { assertCheckoutRequest(body.checkout); } catch { return false; }
    return hasCheckoutDiscount(body.checkout as CheckoutRequest);
  }
  return typeof body.orderId === 'string' && body.orderId.trim().length > 0;
};

export const registerSupervisorAuthorizationRoute = (app: Express, db: TransactionalSqlExecutor, verifySupervisorToken?: SupabaseTokenVerifier): void => {
  const tokenVerifier = verifySupervisorToken ?? createSupabaseTokenVerifier(process.env.SUPABASE_POS_AUTH_URL, process.env.SUPABASE_POS_AUTH_JWKS_URL);
  app.post('/api/v1/authorizations/supervisor', async (request: Request, response: Response) => {
    const context = request.prodxContext;
    if (!context) {
      response.status(500).json({ error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.' } });
      return;
    }
    if (!valid(request.body)) {
      response.status(400).json({ error: { code: 'SUPERVISOR_AUTH_VALIDATION_FAILED', message: 'Malformed supervisor authorization request.' } });
      return;
    }
    const body = request.body;
    const authorizer = request.app.locals.prodxAuthorize as ((ctx: typeof context, permission: string) => Promise<boolean>) | undefined;
    const requesterPermission = body.action === 'discount' ? 'pos.discount' : body.action === 'void' ? 'pos.void' : 'pos.refund';
    if (!authorizer || !(await authorizer(context, requesterPermission))) {
      response.status(403).json({ error: { code: 'FORBIDDEN', message: 'The requester is not authorized to request this supervisor approval.' } });
      return;
    }
    const sessionId = 'sessionId' in context.principal && typeof context.principal.sessionId === 'string' ? context.principal.sessionId : null;
    if (!sessionId) {
      response.status(500).json({ error: { code: 'SESSION_CONTEXT_MISSING', message: 'Authenticated session context is required.' } });
      return;
    }

    let verifiedSupervisorIdentity = null as Awaited<ReturnType<SupabaseTokenVerifier>>;
    if (body.supervisorAccessToken) {
      try {
        verifiedSupervisorIdentity = await tokenVerifier(body.supervisorAccessToken);
      } catch {
        response.status(503).json({ error: { code: 'SUPERVISOR_IDENTITY_PROVIDER_UNAVAILABLE', message: 'Supervisor identity verification is temporarily unavailable.' } });
        return;
      }
    }
    try {
      const outcome = await db.transaction(async (tx) => {
        try {
        const service = createSupervisorAuthorizationService({
          query: async <T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) =>
            (await tx.query<T>(sql, parameters)).rows,
        });
        let supervisorUserId = body.supervisorUserId;
        let supervisorIdentityVerified = false;
        if (body.supervisorAccessToken) {
          if (!verifiedSupervisorIdentity) {
            await tx.query(`SELECT public.prodx_record_security_audit_event($1, $2, $3, 'SUPERVISOR_AUTH_FAILED', $4::jsonb)`, [
              crypto.randomUUID(), context.principal.organizationId, context.principal.userId,
              JSON.stringify({ action: body.action, reason: 'supabase_reauthentication_failed' }),
            ]);
            throw new SupervisorAuthorizationError('INVALID_CREDENTIALS');
          }
          const mappedSupervisor = (await tx.query<{ userId: string; status: string }>(
            `SELECT user_id AS "userId", status
               FROM public.prodx_auth_find_supervisor_by_supabase_subject($1, $2, $3)`,
            [context.principal.organizationId, context.principal.storeId, verifiedSupervisorIdentity.userId],
          )).rows[0];
          if (!mappedSupervisor || mappedSupervisor.status !== 'active' || mappedSupervisor.userId !== body.supervisorUserId) {
            await tx.query(`SELECT public.prodx_record_security_audit_event($1, $2, $3, 'SUPERVISOR_AUTH_DENIED', $4::jsonb)`, [
              crypto.randomUUID(), context.principal.organizationId, context.principal.userId,
              JSON.stringify({ action: body.action, reason: 'supabase_subject_not_authorized' }),
            ]);
            throw new SupervisorAuthorizationError('SUPERVISOR_NOT_ALLOWED');
          }
          supervisorUserId = mappedSupervisor.userId;
          supervisorIdentityVerified = true;
        }
        if (body.action === 'discount') {
          const checkout = body.checkout as CheckoutRequest;
          if (checkout.storeId !== context.principal.storeId || checkout.cashierId !== context.principal.userId) {
            throw new SupervisorAuthorizationError('SUPERVISOR_NOT_ALLOWED');
          }
          const policy = (await tx.query<{ require_supervisor_approval: boolean; max_discount_without_approval_bps: number }>(
            `SELECT require_supervisor_approval, max_discount_without_approval_bps
               FROM prodx_discount_policies
              WHERE organization_id = $1 AND store_id = $2
              FOR SHARE`,
            [context.principal.organizationId, context.principal.storeId],
          )).rows[0];
          if (!policy) throw new Error('Authoritative discount policy is missing for this store.');
          // Match checkout's authoritative integer half-up basis-point calculation.
          // Never use floating-point arithmetic for policy threshold decisions.
          const grossCents = BigInt(checkout.totals.grossSubtotal.amountInCents);
          const discountCents = grossCents - BigInt(checkout.totals.grandTotal.amountInCents);
          const effectiveDiscountBps = grossCents > 0n
            ? Number((discountCents * 10000n + grossCents / 2n) / grossCents)
            : 0;
          const maxDiscountBps = Math.max(effectiveDiscountBps, checkout.orderDiscountBps ?? 0, ...checkout.items.map((item) => item.discountBps));
          if (!policy.require_supervisor_approval || maxDiscountBps <= Number(policy.max_discount_without_approval_bps)) {
            throw new SupervisorAuthorizationError('SUPERVISOR_NOT_ALLOWED');
          }
          await tx.query(
            `SELECT public.prodx_record_security_audit_event($1, $2, $3, 'SUPERVISOR_AUTHORIZATION_REQUESTED', $4::jsonb)`,
            [crypto.randomUUID(), context.principal.organizationId, context.principal.userId,
             JSON.stringify({ action: 'discount', idempotencyKey: checkout.idempotencyKey, payloadHash: checkoutAuthorizationFingerprint(checkout), thresholdBps: Number(policy.max_discount_without_approval_bps) })],
          );
          return { result: await service.authorize({
            organizationId: context.principal.organizationId,
            storeId: context.principal.storeId,
            requesterUserId: context.principal.userId,
            requesterSessionId: sessionId,
            action: 'discount',
            checkoutIdempotencyKey: checkout.idempotencyKey,
            checkoutPayloadHash: checkoutAuthorizationFingerprint(checkout),
            policyThresholdBps: Number(policy.max_discount_without_approval_bps),
            policyRequiresApproval: true,
            supervisorUsername: body.supervisorUsername,
            supervisorUserId,
            supervisorSecret: body.supervisorSecret,
            supervisorIdentityVerified,
          }) };
        }
        return { result: await service.authorize({
          organizationId: context.principal.organizationId,
          storeId: context.principal.storeId,
          requesterUserId: context.principal.userId,
          requesterSessionId: sessionId,
          action: body.action,
          orderId: body.orderId,
          supervisorUsername: body.supervisorUsername,
          supervisorUserId,
          supervisorSecret: body.supervisorSecret,
          supervisorIdentityVerified,
        }) };
        } catch (error) {
          if (error instanceof SupervisorAuthorizationError) return { authorizationError: error };
          throw error;
        }
      });
      if ('authorizationError' in outcome) throw outcome.authorizationError;
      response.status(201).json(outcome.result);
    } catch (error) {
      if (error instanceof SupervisorAuthorizationError) {
        const status = error.code === 'SUPERVISOR_NOT_ALLOWED' ? 403 : 401;
        response.status(status).json({ error: { code: error.code, message: 'Supervisor authorization was not granted.' } });
        return;
      }
      throw error;
    }
  });
};
