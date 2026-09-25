import crypto from 'node:crypto';
import type { RequestPrincipal } from '../http/types';

export type AuthenticatedSession = RequestPrincipal & { sessionId: string };
export type CredentialRecord = {
  userId: string; organizationId: string; username: string;
  status: 'active' | 'disabled'; credentialType: 'password'; secretHash: string;
  failedAttempts: number; lockedUntil: Date | null;
};
export type SessionRecord = {
  id: string; organizationId: string; userId: string; deviceId: string;
  tokenHash: string; expiresAt: Date; revokedAt: Date | null; userStatus: 'active' | 'disabled';
};
export type DeviceRecord = { id: string; organizationId: string; storeId: string; status: 'active' | 'disabled'; };
export type AuthenticationRepository = {
  findCredentialByUsername: (username: string) => Promise<CredentialRecord | null>;
  recordFailedAttempt: (userId: string, lockedUntil?: Date) => Promise<void>;
  resetFailedAttempts: (userId: string) => Promise<void>;
  createSession: (input: { id: string; organizationId: string; userId: string; deviceId: string; tokenHash: string; expiresAt: Date }) => Promise<void>;
  findSessionByTokenHash: (tokenHash: string) => Promise<SessionRecord | null>;
  findDevice: (deviceId: string) => Promise<DeviceRecord | null>;
  findDeviceByKey: (organizationId: string, deviceKey: string) => Promise<DeviceRecord | null>;
  revokeSession: (sessionId: string, at: Date) => Promise<void>;
  touchSession: (sessionId: string, at: Date) => Promise<void>;
};
export type AuthenticateCredentialsInput = { username: string; password: string; deviceId: string };
export type SessionIssuer = {
  authenticateCredentials: (input: AuthenticateCredentialsInput) => Promise<{ token: string; sessionId: string; expiresAt: Date } | null>;
  authenticateBearer: (token: string) => Promise<AuthenticatedSession | null>;
  revokeBearer: (token: string) => Promise<boolean>;
};

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export const hashSessionToken = (token: string): string => crypto.createHash('sha256').update(token, 'utf8').digest('hex');
const newBearerToken = (): string => crypto.randomBytes(32).toString('base64url');

export const createSessionIssuer = (
  repository: AuthenticationRepository,
  verifySecret: (secret: string, encodedHash: string) => Promise<boolean>,
  now: () => Date = () => new Date(),
): SessionIssuer => ({
  authenticateCredentials: async ({ username, password, deviceId }) => {
    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password || !deviceId) return null;
    const credential = await repository.findCredentialByUsername(normalizedUsername);
    if (!credential || credential.status !== 'active' || credential.credentialType !== 'password') return null;
    const current = now();
    if (credential.lockedUntil && credential.lockedUntil > current) return null;
    const device = await repository.findDevice(deviceId);
    if (!device || device.status !== 'active' || device.organizationId !== credential.organizationId) return null;
    if (!(await verifySecret(password, credential.secretHash))) {
      const nextFailedAttempts = credential.failedAttempts + 1;
      const lockedUntil = nextFailedAttempts >= MAX_FAILED_ATTEMPTS ? new Date(current.getTime() + LOCKOUT_DURATION_MS) : undefined;
      await repository.recordFailedAttempt(credential.userId, lockedUntil);
      return null;
    }
    await repository.resetFailedAttempts(credential.userId);
    const token = newBearerToken();
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(current.getTime() + SESSION_TTL_MS);
    await repository.createSession({ id: sessionId, organizationId: credential.organizationId, userId: credential.userId, deviceId: device.id, tokenHash: hashSessionToken(token), expiresAt });
    return { token, sessionId, expiresAt };
  },
  authenticateBearer: async (token) => {
    if (!token) return null;
    const session = await repository.findSessionByTokenHash(hashSessionToken(token));
    if (!session || session.revokedAt || session.expiresAt <= now() || session.userStatus !== 'active') return null;
    const device = await repository.findDevice(session.deviceId);
    if (!device || device.status !== 'active' || device.organizationId !== session.organizationId) return null;
    await repository.touchSession(session.id, now());
    return { sessionId: session.id, userId: session.userId, organizationId: session.organizationId, storeId: device.storeId };
  },
  revokeBearer: async (token) => {
    if (!token) return false;
    const session = await repository.findSessionByTokenHash(hashSessionToken(token));
    if (!session || session.revokedAt) return false;
    await repository.revokeSession(session.id, now());
    return true;
  },
});
