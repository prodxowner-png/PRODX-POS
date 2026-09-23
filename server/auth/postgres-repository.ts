import crypto from 'node:crypto';
import type { AuthenticationRepository, CredentialRecord, DeviceRecord, SessionRecord } from './session';

export type SqlExecutor = {
  query<T extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]): Promise<readonly T[]>;
};

export const createPostgresAuthenticationRepository = (db: SqlExecutor): AuthenticationRepository => ({
  async findCredentialByUsername(username) {
    const rows = await db.query<CredentialRecord & { credential_type: 'password'; secret_hash: string; failed_attempts: number; locked_until: Date | null; }>(
      `SELECT u.id AS "userId", u.organization_id AS "organizationId", u.username,
              u.status, c.credential_type, c.secret_hash, c.failed_attempts, c.locked_until
         FROM prodx_users u JOIN prodx_user_credentials c ON c.user_id = u.id
        WHERE lower(u.username) = lower($1) LIMIT 1`, [username]);
    const row = rows[0]; if (!row) return null;
    return { userId: row.userId, organizationId: row.organizationId, username: row.username, status: row.status,
      credentialType: row.credential_type, secretHash: row.secret_hash, failedAttempts: row.failed_attempts, lockedUntil: row.locked_until };
  },
  async recordFailedAttempt(userId, lockedUntil) {
    await db.query(`WITH updated AS (
      UPDATE prodx_user_credentials SET failed_attempts = failed_attempts + 1,
      locked_until = CASE WHEN $2::timestamptz IS NULL THEN locked_until ELSE $2::timestamptz END,
      updated_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND (locked_until IS NULL OR locked_until <= CURRENT_TIMESTAMP)
      RETURNING user_id, failed_attempts, locked_until)
      INSERT INTO prodx_security_audit_events (id, organization_id, user_id, event_type, metadata)
      SELECT $3::uuid, u.organization_id, updated.user_id, 'AUTH_LOCKOUT',
      jsonb_build_object('failed_attempts', updated.failed_attempts, 'locked_until', updated.locked_until)
      FROM updated JOIN prodx_users u ON u.id = updated.user_id
      WHERE updated.failed_attempts = 5 AND updated.locked_until IS NOT NULL`, [userId, lockedUntil ?? null, crypto.randomUUID()]);
  },
  async resetFailedAttempts(userId) {
    await db.query(`WITH previous AS (
      SELECT user_id, failed_attempts, locked_until FROM prodx_user_credentials WHERE user_id = $1 FOR UPDATE),
      updated AS (UPDATE prodx_user_credentials c SET failed_attempts = 0, locked_until = NULL,
      last_authenticated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP FROM previous
      WHERE c.user_id = previous.user_id RETURNING c.user_id)
      INSERT INTO prodx_security_audit_events (id, organization_id, user_id, event_type, metadata)
      SELECT $2::uuid, u.organization_id, previous.user_id, 'AUTH_LOCKOUT_RESET',
      jsonb_build_object('previous_failed_attempts', previous.failed_attempts, 'previous_locked_until', previous.locked_until)
      FROM previous JOIN prodx_users u ON u.id = previous.user_id
      WHERE previous.failed_attempts > 0 OR previous.locked_until IS NOT NULL`, [userId, crypto.randomUUID()]);
  },
  async createSession(input) {
    await db.query(`INSERT INTO prodx_sessions (id, organization_id, user_id, device_id, token_hash, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)`, [input.id, input.organizationId, input.userId, input.deviceId, input.tokenHash, input.expiresAt]);
  },
  async findSessionByTokenHash(tokenHash) {
    const rows = await db.query<{ id:string; organization_id:string; user_id:string; device_id:string; token_hash:string; expires_at:Date; revoked_at:Date|null; user_status:'active'|'disabled'; }>(
      `SELECT s.id, s.organization_id, s.user_id, s.device_id, s.token_hash, s.expires_at, s.revoked_at,
              u.status AS user_status FROM prodx_sessions s
       JOIN prodx_users u ON u.id = s.user_id AND u.organization_id = s.organization_id
       WHERE s.token_hash = $1 LIMIT 1`, [tokenHash]);
    const row=rows[0]; if(!row) return null;
    return {id:row.id,organizationId:row.organization_id,userId:row.user_id,deviceId:row.device_id,tokenHash:row.token_hash,expiresAt:row.expires_at,revokedAt:row.revoked_at,userStatus:row.user_status} satisfies SessionRecord;
  },
  async findDevice(deviceId) {
    const rows=await db.query<{id:string;organization_id:string;store_id:string;status:'active'|'disabled';}>(
      `SELECT id, organization_id, store_id, status FROM prodx_devices WHERE id = $1 LIMIT 1`,[deviceId]);
    const row=rows[0]; if(!row)return null;
    return {id:row.id,organizationId:row.organization_id,storeId:row.store_id,status:row.status} satisfies DeviceRecord;
  },
  async findDeviceByKey(organizationId, deviceKey) {
    const rows=await db.query<{id:string;organization_id:string;store_id:string;status:'active'|'disabled';}>(
      `SELECT id, organization_id, store_id, status FROM prodx_devices WHERE organization_id=$1 AND device_key=$2 LIMIT 1`,[organizationId,deviceKey]);
    const row=rows[0]; if(!row)return null;
    return {id:row.id,organizationId:row.organization_id,storeId:row.store_id,status:row.status} satisfies DeviceRecord;
  },
  async revokeSession(sessionId, at) {
    await db.query(`UPDATE prodx_sessions SET revoked_at=$2 WHERE id=$1 AND revoked_at IS NULL`,[sessionId,at]);
  },
  async touchSession(sessionId, at) {
    await db.query(`UPDATE prodx_sessions SET last_seen_at=$2 WHERE id=$1 AND revoked_at IS NULL AND expires_at>$2`,[sessionId,at]);
  },
});
