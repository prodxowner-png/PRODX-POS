import crypto from 'node:crypto';
import type { SqlExecutor } from './postgres-repository';
import { verifyPassword } from './password';

export type SupervisorAuthorizationRequest = {
  organizationId: string;
  storeId: string;
  requesterUserId: string;
  requesterSessionId: string;
  action: 'refund' | 'void';
  orderId: string;
  supervisorUsername?: string;
  supervisorUserId?: string;
  supervisorSecret: string;
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
  input: { organizationId: string; storeId: string; userId?: string | null; eventType: string; metadata: Record<string, unknown> },
): Promise<void> => {
  await db.query(
    `SELECT public.prodx_record_supervisor_authorization_event(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::jsonb
    )`,
    [crypto.randomUUID(), input.organizationId, input.storeId, input.userId ?? null, input.eventType, JSON.stringify(input.metadata)],
  );
};

export const createSupervisorAuthorizationService = (db: SqlExecutor, now: () => Date = () => new Date()) => ({
  async authorize(input: SupervisorAuthorizationRequest): Promise<SupervisorAuthorizationResult> {
    if (!input.organizationId || !input.storeId || !input.requesterUserId || !input.requesterSessionId ||
        !input.orderId || (!input.supervisorUsername?.trim() && !input.supervisorUserId?.trim()) || !input.supervisorSecret) {
      throw new SupervisorAuthorizationError('INVALID_CREDENTIALS');
    }

    const credentials = await db.query<{
      userId: string; status: 'active' | 'disabled';
      secretHash: string; failedAttempts: number; lockedUntil: Date | null;
    }>(
      `SELECT supervisor_user_id AS "userId",
              user_status AS "status",
              secret_hash AS "secretHash",
              failed_attempts AS "failedAttempts",
              locked_until AS "lockedUntil"
         FROM public.prodx_supervisor_find_credential($1::uuid, $2::uuid, $3::text)`,
      [input.organizationId, input.storeId, (input.supervisorUserId ?? input.supervisorUsername ?? '').trim()],
    );
    const credential = credentials[0];
    const current = now();

    if (!credential || credential.status !== 'active' ||
        (credential.lockedUntil && credential.lockedUntil > current)) {
      await recordSecurityEvent(db, {
        organizationId: input.organizationId,
        storeId: input.storeId,
        userId: credential?.userId ?? null,
        eventType: 'SUPERVISOR_AUTH_REJECTED',
        metadata: { action: input.action, orderId: input.orderId, requesterUserId: input.requesterUserId, reason: 'invalid_or_locked' },
      });
      throw new SupervisorAuthorizationError('INVALID_CREDENTIALS');
    }

    const valid = await verifyPassword(input.supervisorSecret, credential.secretHash);
    if (!valid) {
      // Increment in SQL via tenant-bound SECURITY DEFINER RPC so prodx_app never
      // needs direct table access to prodx_user_credentials and concurrent failures serialize.
      await db.query(
        `SELECT public.prodx_supervisor_record_failed_attempt($1::uuid, $2::uuid, $3::uuid)`,
        [input.organizationId, input.storeId, credential.userId],
      );
      await recordSecurityEvent(db, {
        organizationId: input.organizationId,
        storeId: input.storeId,
        userId: credential.userId,
        eventType: 'SUPERVISOR_AUTH_FAILED',
        metadata: { action: input.action, orderId: input.orderId, requesterUserId: input.requesterUserId },
      });
      throw new SupervisorAuthorizationError('INVALID_CREDENTIALS');
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
          AND p.permission_key = CASE WHEN $4 = 'void' THEN 'pos.void' ELSE 'pos.refund' END
        LIMIT 1`,
      [input.organizationId, input.storeId, credential.userId, input.action],
    );
    if (!allowed[0]) {
      await recordSecurityEvent(db, {
        organizationId: input.organizationId,
        storeId: input.storeId,
        userId: credential.userId,
        eventType: 'SUPERVISOR_AUTH_DENIED',
        metadata: { action: input.action, orderId: input.orderId, requesterUserId: input.requesterUserId, reason: 'store_permission_missing' },
      });
      throw new SupervisorAuthorizationError('SUPERVISOR_NOT_ALLOWED');
    }

    await db.query(
      `SELECT public.prodx_supervisor_reset_failed_attempts($1::uuid, $2::uuid, $3::uuid, $4::text)`,
      [input.organizationId, input.storeId, credential.userId, input.action],
    );

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(current.getTime() + TTL_MS);
    await db.query(
      `INSERT INTO prodx_supervisor_authorizations
        (id, organization_id, store_id, requester_user_id, requester_session_id,
         supervisor_user_id, action_key, order_id, authorization_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [crypto.randomUUID(), input.organizationId, input.storeId, input.requesterUserId,
       input.requesterSessionId, credential.userId, input.action, input.orderId,
       hashAuthorizationToken(token), expiresAt],
    );
    await recordSecurityEvent(db, {
      organizationId: input.organizationId,
      storeId: input.storeId,
      userId: credential.userId,
      eventType: 'SUPERVISOR_AUTHORIZATION_GRANTED',
      metadata: { action: input.action, orderId: input.orderId, requesterUserId: input.requesterUserId, requesterSessionId: input.requesterSessionId, expiresAt: expiresAt.toISOString() },
    });

    return { authorizationToken: token, supervisorUserId: credential.userId, expiresAt: expiresAt.toISOString() };
  },

  async consume(input: {
    token: string; organizationId: string; storeId: string; requesterUserId: string;
    requesterSessionId: string; action: 'refund' | 'void'; orderId: string;
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
          AND order_id = $7
          AND consumed_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP
        RETURNING supervisor_user_id AS "supervisorUserId"`,
      [hash, input.organizationId, input.storeId, input.requesterUserId,
       input.requesterSessionId, input.action, input.orderId],
    );
    if (rows[0]) return { supervisorUserId: rows[0].supervisorUserId };

    const state = await db.query<{ consumedAt: Date | null; expiresAt: Date }>(
      `SELECT consumed_at AS "consumedAt", expires_at AS "expiresAt"
         FROM prodx_supervisor_authorizations
        WHERE authorization_hash = $1
          AND organization_id = $2
          AND store_id = $3
          AND requester_user_id = $4
          AND requester_session_id = $5
          AND action_key = $6
          AND order_id = $7
        LIMIT 1`,
      [hash, input.organizationId, input.storeId, input.requesterUserId,
       input.requesterSessionId, input.action, input.orderId],
    );
    if (state[0]?.consumedAt) throw new SupervisorAuthorizationError('AUTHORIZATION_REPLAYED');
    throw new SupervisorAuthorizationError('AUTHORIZATION_EXPIRED');
  },
});
