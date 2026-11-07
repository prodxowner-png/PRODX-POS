import crypto from 'node:crypto';
import type { SqlExecutor } from './postgres-repository';
import { verifyPassword } from './password';

export type SupervisorAuthorizationRequest = {
  organizationId: string;
  storeId: string;
  requesterUserId: string;
  requesterSessionId: string;
  action: 'refund' | 'void' | 'discount';
  orderId?: string;
  checkoutIdempotencyKey?: string;
  checkoutPayloadHash?: string;
  policyThresholdBps?: number;
  policyRequiresApproval?: boolean;
  supervisorUsername?: string;
  supervisorUserId?: string;
  supervisorSecret?: string;
  supervisorIdentityVerified?: boolean;
};

export type SupervisorAuthorizationResult = {
  authorizationToken: string;
  supervisorUserId: string;
  expiresAt: string;
};

export class SupervisorAuthorizationError extends Error {
  constructor(public readonly code: 'INVALID_CREDENTIALS' | 'SUPERVISOR_NOT_ALLOWED' | 'AUTHORIZATION_EXPIRED' | 'AUTHORIZATION_REPLAYED') {
    super(code);
  }
}

const TTL_MS = 2 * 60 * 1000;

export const hashAuthorizationToken = (token: string): string =>
  crypto.createHash('sha256').update(token, 'utf8').digest('hex');

const recordSecurityEvent = async (
  db: SqlExecutor,
  input: { organizationId: string; userId?: string | null; eventType: string; metadata: Record<string, unknown> },
): Promise<void> => {
  await db.query(
    `SELECT public.prodx_record_security_audit_event($1, $2, $3, $4, $5::jsonb)`,
    [crypto.randomUUID(), input.organizationId, input.userId ?? null, input.eventType, JSON.stringify(input.metadata)],
  );
};

export const createSupervisorAuthorizationService = (db: SqlExecutor, now: () => Date = () => new Date()) => ({
  async authorize(input: SupervisorAuthorizationRequest): Promise<SupervisorAuthorizationResult> {
    const identityVerified = input.supervisorIdentityVerified === true;
    if (!input.organizationId || !input.storeId || !input.requesterUserId || !input.requesterSessionId ||
        (input.action === 'discount'
          ? (!input.checkoutIdempotencyKey?.trim() || !/^[0-9a-f]{64}$/.test(input.checkoutPayloadHash ?? '') ||
             !Number.isInteger(input.policyThresholdBps) || input.policyThresholdBps! < 0 || input.policyThresholdBps! > 10000 || input.policyRequiresApproval !== true)
          : !input.orderId) ||
        (identityVerified ? !input.supervisorUserId?.trim() : ((!input.supervisorUsername?.trim() && !input.supervisorUserId?.trim()) || !input.supervisorSecret))) {
      throw new SupervisorAuthorizationError('INVALID_CREDENTIALS');
    }

    let supervisorUserId = input.supervisorUserId ?? null;
    let credential: {
      userId: string; organizationId: string; status: 'active' | 'disabled';
      secretHash: string; failedAttempts: number; lockedUntil: Date | null;
    } | undefined;
    const current = now();

    // Supabase-authenticated supervisors are reauthenticated in an isolated client;
    // the server verifies that JWT and maps its subject to the POS identity. Legacy
    // local-password credentials remain supported without granting table access.
    if (!identityVerified) {
      const credentials = await db.query<{
        userId: string; organizationId: string; status: 'active' | 'disabled';
        secretHash: string; failedAttempts: number; lockedUntil: Date | null;
      }>(
        `SELECT * FROM public.prodx_auth_find_supervisor_credential($1, $2, $3)`,
        [input.organizationId, input.storeId, (input.supervisorUserId ?? input.supervisorUsername ?? '').trim()],
      );
      credential = credentials[0];
      supervisorUserId = credential?.userId ?? null;

      if (!credential || credential.status !== 'active' ||
          (credential.lockedUntil && credential.lockedUntil > current)) {
        await recordSecurityEvent(db, {
          organizationId: input.organizationId,
          userId: credential?.userId ?? null,
          eventType: 'SUPERVISOR_AUTH_REJECTED',
          metadata: { action: input.action, orderId: input.orderId, requesterUserId: input.requesterUserId, reason: 'invalid_or_locked' },
        });
        throw new SupervisorAuthorizationError('INVALID_CREDENTIALS');
      }

      const valid = await verifyPassword(input.supervisorSecret!, credential.secretHash);
      if (!valid) {
        await db.query(
          `SELECT public.prodx_auth_record_failed_attempt($1, $2, $3)`,
          [credential.userId, input.organizationId, crypto.randomUUID()],
        );
        await recordSecurityEvent(db, {
          organizationId: input.organizationId,
          userId: credential.userId,
          eventType: 'SUPERVISOR_AUTH_FAILED',
          metadata: { action: input.action, orderId: input.orderId, requesterUserId: input.requesterUserId },
        });
        throw new SupervisorAuthorizationError('INVALID_CREDENTIALS');
      }
    }

    const allowed = await db.query<{ userId: string }>(
      `SELECT m.user_id AS "userId"
         FROM prodx_store_memberships m
         JOIN prodx_user_roles ur
           ON ur.organization_id = m.organization_id
          AND ur.user_id = m.user_id
          AND ur.store_id = m.store_id
          AND ur.active = TRUE
         JOIN prodx_roles r
           ON r.id = ur.role_id
          AND r.organization_id = ur.organization_id
          AND r.active = TRUE
         JOIN prodx_role_permissions rp
           ON rp.organization_id = r.organization_id
          AND rp.role_id = r.id
         JOIN prodx_permissions p
           ON p.id = rp.permission_id
        WHERE m.organization_id = $1
          AND m.store_id = $2
          AND m.user_id = $3
          AND m.active = TRUE
          AND p.permission_key = CASE WHEN $4 = 'void' THEN 'pos.void' WHEN $4 = 'discount' THEN 'pos.discount.approve' ELSE 'pos.refund' END
        LIMIT 1`,
      [input.organizationId, input.storeId, supervisorUserId, input.action],
    );
    if (!allowed[0]) {
      await recordSecurityEvent(db, {
        organizationId: input.organizationId,
        userId: supervisorUserId,
        eventType: 'SUPERVISOR_AUTH_DENIED',
        metadata: { action: input.action, orderId: input.orderId, requesterUserId: input.requesterUserId, reason: 'store_permission_missing' },
      });
      throw new SupervisorAuthorizationError('SUPERVISOR_NOT_ALLOWED');
    }

    if (credential) {
      await db.query(
        `SELECT public.prodx_auth_reset_failed_attempts($1, $2, $3)`,
        [credential.userId, input.organizationId, crypto.randomUUID()],
      );
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(current.getTime() + TTL_MS);
    await db.query(
      `INSERT INTO prodx_supervisor_authorizations
        (id, organization_id, store_id, requester_user_id, requester_session_id,
         supervisor_user_id, action_key, order_id, checkout_idempotency_key, checkout_payload_hash,
         policy_threshold_bps, policy_requires_approval, authorization_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [crypto.randomUUID(), input.organizationId, input.storeId, input.requesterUserId,
       input.requesterSessionId, supervisorUserId, input.action, input.orderId ?? null,
       input.checkoutIdempotencyKey ?? null, input.checkoutPayloadHash ?? null,
       input.policyThresholdBps ?? null, input.policyRequiresApproval ?? null,
       hashAuthorizationToken(token), expiresAt],
    );
    await recordSecurityEvent(db, {
      organizationId: input.organizationId,
      userId: supervisorUserId,
      eventType: 'SUPERVISOR_AUTHORIZATION_GRANTED',
      metadata: { action: input.action, orderId: input.orderId, requesterUserId: input.requesterUserId, requesterSessionId: input.requesterSessionId, expiresAt: expiresAt.toISOString() },
    });

    return { authorizationToken: token, supervisorUserId: supervisorUserId!, expiresAt: expiresAt.toISOString() };
  },

  async consume(input: {
    token: string; organizationId: string; storeId: string; requesterUserId: string;
    requesterSessionId: string; action: 'refund' | 'void' | 'discount'; orderId?: string;
    checkoutIdempotencyKey?: string; checkoutPayloadHash?: string;
    policyThresholdBps?: number; policyRequiresApproval?: boolean;
  }): Promise<{ supervisorUserId: string }> {
    if (!input.token.trim()) throw new SupervisorAuthorizationError('AUTHORIZATION_EXPIRED');
    const hash = hashAuthorizationToken(input.token);
    const rows = await db.query<{ supervisorUserId: string }>(
      `UPDATE prodx_supervisor_authorizations
          SET consumed_at = CURRENT_TIMESTAMP
        WHERE authorization_hash = $1
          AND organization_id = $2
          AND store_id = $3
          AND requester_user_id = $4
          AND requester_session_id = $5
          AND action_key = $6
          AND order_id IS NOT DISTINCT FROM $7
          AND checkout_idempotency_key IS NOT DISTINCT FROM $8
          AND checkout_payload_hash IS NOT DISTINCT FROM $9
          AND policy_threshold_bps IS NOT DISTINCT FROM $10
          AND policy_requires_approval IS NOT DISTINCT FROM $11
          AND consumed_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP
        RETURNING supervisor_user_id AS "supervisorUserId"`,
      [hash, input.organizationId, input.storeId, input.requesterUserId,
       input.requesterSessionId, input.action, input.orderId ?? null, input.checkoutIdempotencyKey ?? null,
       input.checkoutPayloadHash ?? null, input.policyThresholdBps ?? null, input.policyRequiresApproval ?? null],
    );
    if (rows[0]) {
      await recordSecurityEvent(db, { organizationId: input.organizationId, userId: rows[0].supervisorUserId,
        eventType: 'SUPERVISOR_AUTHORIZATION_CONSUMED',
        metadata: { action: input.action, orderId: input.orderId ?? null, idempotencyKey: input.checkoutIdempotencyKey ?? null, requesterUserId: input.requesterUserId } });
      return { supervisorUserId: rows[0].supervisorUserId };
    }

    const state = await db.query<{ consumedAt: Date | null; expiresAt: Date }>(
      `SELECT consumed_at AS "consumedAt", expires_at AS "expiresAt"
         FROM prodx_supervisor_authorizations
        WHERE authorization_hash = $1
          AND organization_id = $2
          AND store_id = $3
          AND requester_user_id = $4
          AND requester_session_id = $5
          AND action_key = $6
          AND order_id IS NOT DISTINCT FROM $7
          AND checkout_idempotency_key IS NOT DISTINCT FROM $8
          AND checkout_payload_hash IS NOT DISTINCT FROM $9
          AND policy_threshold_bps IS NOT DISTINCT FROM $10
          AND policy_requires_approval IS NOT DISTINCT FROM $11
        LIMIT 1`,
      [hash, input.organizationId, input.storeId, input.requesterUserId,
       input.requesterSessionId, input.action, input.orderId ?? null, input.checkoutIdempotencyKey ?? null,
       input.checkoutPayloadHash ?? null, input.policyThresholdBps ?? null, input.policyRequiresApproval ?? null],
    );
    if (state[0]?.consumedAt) {
      await recordSecurityEvent(db, { organizationId: input.organizationId, userId: input.requesterUserId,
        eventType: 'SUPERVISOR_AUTHORIZATION_REPLAYED',
        metadata: { action: input.action, orderId: input.orderId ?? null, idempotencyKey: input.checkoutIdempotencyKey ?? null } });
      throw new SupervisorAuthorizationError('AUTHORIZATION_REPLAYED');
    }
    throw new SupervisorAuthorizationError('AUTHORIZATION_EXPIRED');
  },
});
