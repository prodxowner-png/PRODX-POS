import crypto from 'node:crypto';
import type { AuthenticationRepository, CredentialRecord, DeviceRecord, SessionRecord, SupabasePrincipalRecord } from './session';

export type SqlExecutor = {
  query<T extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]): Promise<readonly T[]>;
};

export type FirstTenantBootstrapInput = {
  supabaseUserId: string;
  organizationCode: string;
  organizationName: string;
  storeCode: string;
  storeName: string;
  businessTimezone: string;
  ownerUsername: string;
  ownerDisplayName: string;
  deviceKey: string;
  deviceName: string;
};

export type FirstTenantBootstrapResult = {
  organizationId: string;
  storeId: string;
  userId: string;
  roleId: string;
  deviceId: string;
};

export type FirstTenantBootstrapRepository = {
  bootstrapFirstTenant(input: FirstTenantBootstrapInput): Promise<FirstTenantBootstrapResult | null>;
};

export const createPostgresFirstTenantBootstrapRepository = (db: SqlExecutor): FirstTenantBootstrapRepository => ({
  async bootstrapFirstTenant(input) {
    const rows = await db.query<{
      organization_id: string;
      store_id: string;
      user_id: string;
      role_id: string;
      device_id: string;
    }>(
      `SELECT * FROM public.prodx_auth_bootstrap_first_tenant(
        $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10
      )`,
      [
        input.supabaseUserId,
        input.organizationCode,
        input.organizationName,
        input.storeCode,
        input.storeName,
        input.businessTimezone,
        input.ownerUsername,
        input.ownerDisplayName,
        input.deviceKey,
        input.deviceName,
      ],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      organizationId: row.organization_id,
      storeId: row.store_id,
      userId: row.user_id,
      roleId: row.role_id,
      deviceId: row.device_id,
    };
  },
});

export const createPostgresAuthenticationRepository = (db: SqlExecutor): AuthenticationRepository => ({
  async findCredentialByUsername(username, deviceId) {
    const rows = await db.query<CredentialRecord & { credential_type: 'password'; secret_hash: string; failed_attempts: number; locked_until: Date | null; }>(
      `SELECT * FROM public.prodx_auth_find_credential_by_username($1, $2::uuid)`,
      [username, deviceId],
    );
    const row = rows[0];
    if (!row) return null;
    return { userId: row.userId, organizationId: row.organizationId, username: row.username, status: row.status,
      credentialType: row.credential_type, secretHash: row.secret_hash, failedAttempts: row.failed_attempts, lockedUntil: row.locked_until };
  },
  async findUserBySupabaseUserId(supabaseUserId, deviceId) {
    const rows = await db.query<SupabasePrincipalRecord>(
      `SELECT * FROM public.prodx_auth_find_user_by_supabase_user_id($1::uuid, $2::uuid)`,
      [supabaseUserId, deviceId],
    );
    const row = rows[0];
    if (!row) return null;
    return { userId: row.userId, organizationId: row.organizationId, username: row.username, status: row.status };
  },
  async recordFailedAttempt(userId, organizationId) {
    await db.query(
      `SELECT public.prodx_auth_record_failed_attempt($1::uuid, $2::uuid, $3::uuid)`,
      [userId, organizationId, crypto.randomUUID()],
    );
  },
  async resetFailedAttempts(userId, organizationId) {
    await db.query(
      `SELECT public.prodx_auth_reset_failed_attempts($1::uuid, $2::uuid, $3::uuid)`,
      [userId, organizationId, crypto.randomUUID()],
    );
  },
  async createSession(input) {
    await db.query(
      `SELECT public.prodx_auth_create_session($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::timestamptz)`,
      [input.id, input.organizationId, input.userId, input.deviceId, input.tokenHash, input.expiresAt],
    );
  },
  async findSessionByTokenHash(tokenHash) {
    const rows = await db.query<{ id: string; organization_id: string; user_id: string; device_id: string;
      token_hash: string; expires_at: Date; revoked_at: Date | null; user_status: 'active' | 'disabled' }>(
      `SELECT * FROM public.prodx_auth_find_session_by_token_hash($1)`, [tokenHash]);
    const row = rows[0];
    if (!row) return null;
    return { id: row.id, organizationId: row.organization_id, userId: row.user_id, deviceId: row.device_id,
      tokenHash: row.token_hash, expiresAt: row.expires_at, revokedAt: row.revoked_at, userStatus: row.user_status } satisfies SessionRecord;
  },
  async findDevice(deviceId) {
    const rows = await db.query<{ id: string; organization_id: string; store_id: string; status: 'active' | 'disabled' }>(
      `SELECT * FROM public.prodx_auth_find_device($1::uuid)`, [deviceId]);
    const row = rows[0];
    if (!row) return null;
    return { id: row.id, organizationId: row.organization_id, storeId: row.store_id, status: row.status } satisfies DeviceRecord;
  },
  async revokeSession(sessionId, tokenHash, at) {
    await db.query(
      `SELECT public.prodx_auth_revoke_session($1::uuid, $2, $3::timestamptz)`,
      [sessionId, tokenHash, at],
    );
  },
  async touchSession(sessionId, tokenHash, at) {
    await db.query(
      `SELECT public.prodx_auth_touch_session($1::uuid, $2, $3::timestamptz)`,
      [sessionId, tokenHash, at],
    );
  },
});
