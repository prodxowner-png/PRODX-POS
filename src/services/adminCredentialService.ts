/**
 * PRODX POS — Admin credential management client boundary.
 *
 * The legacy System Owner reset flow is deliberately fail-closed. The old
 * implementation treated browser state / Firestore as credential authority,
 * mutated local credentials before persistence, and could report success when
 * the remote write failed. Credential reset must remain unavailable until a
 * server-authoritative PostgreSQL endpoint verifies the current credential,
 * enforces role/scope, and commits the credential update with an audit row in
 * one transaction. This module must not write credentials or audit records.
 */

import {
  User,
  SYSTEM_OWNER_ADMIN_ID,
  SYSTEM_OWNER_ADMIN_EMAIL,
} from '../domain/auth';

export interface AdminReauthRequest {
  user: User | null | undefined;
  currentPassword?: string;
  biometricVerified?: boolean;
}

export interface AdminReauthResult {
  verified: boolean;
  reauthMethod?: 'password' | 'webauthn_biometric';
  error?: string;
}

export interface ResetSystemOwnerPasswordRequest {
  actor: User | null | undefined;
  currentPassword?: string;
  biometricVerified?: boolean;
  newPassword: string;
  orgId?: string;
  branchId?: string;
}

export interface ResetSystemOwnerPasswordResult {
  success: boolean;
  version?: number;
  updatedAt?: number;
  passwordHash?: string;
  passwordSalt?: string;
  hashAlgorithm?: string;
  reauthMethod?: 'password' | 'webauthn_biometric';
  syncedToFirestore?: boolean;
  error?: string;
}

export interface AdminCredentialDatabaseStatus {
  id: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  hashAlgorithm: string;
  version: number;
  updatedAt: number;
  updatedBy: string;
  reauthMethod: 'password' | 'webauthn_biometric';
  source: 'firestore' | 'local_override' | 'unconfigured' | 'disabled';
}

const SERVER_RESET_UNAVAILABLE =
  'Administrator credential reset is disabled until server-side PostgreSQL verification and atomic audit persistence are available.';

/**
 * Display-only hash diagnostic. This does not verify or change an account
 * credential and must never be used as authorization evidence.
 */
export async function performCryptographicHashAndEncryptionCheck(
  plainSecret: string,
  salt: string,
): Promise<{ valid: boolean; digestHex: string; algorithm: string }> {
  void plainSecret;
  void salt;
  return { valid: false, digestHex: '', algorithm: 'SERVER-MANAGED; CLIENT HASHING DISABLED' };
}

/** Never read Firestore or browser storage as an authoritative credential source. */
export async function fetchSystemOwnerCredentialStatusFromDatabase(): Promise<AdminCredentialDatabaseStatus> {
  return {
    id: SYSTEM_OWNER_ADMIN_ID,
    email: SYSTEM_OWNER_ADMIN_EMAIL,
    passwordHash: '',
    passwordSalt: '',
    hashAlgorithm: 'server-managed; disabled',
    version: 0,
    updatedAt: 0,
    updatedBy: '',
    reauthMethod: 'password',
    source: 'disabled',
  };
}

/** Client-supplied password / biometric flags are not server re-authentication. */
export async function verifySystemOwnerReauthentication(
  _req: AdminReauthRequest,
): Promise<AdminReauthResult> {
  return { verified: false, error: SERVER_RESET_UNAVAILABLE };
}

/**
 * Do not mutate localStorage, Firebase Auth, Firestore, or client audit logs.
 * A future implementation must call the authenticated PostgreSQL API and only
 * return success after its atomic credential + immutable-audit transaction commits.
 */
export async function resetSystemOwnerAdminPasswordInDatabase(
  _req: ResetSystemOwnerPasswordRequest,
): Promise<ResetSystemOwnerPasswordResult> {
  return { success: false, error: SERVER_RESET_UNAVAILABLE };
}
