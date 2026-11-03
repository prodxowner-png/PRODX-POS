/**
 * PRODX POS — WebAuthn client boundary.
 * Browser-created challenges, local storage, demo identities, and virtual signatures
 * are not authentication evidence. Until a server-owned challenge/credential store
 * and cryptographic assertion verifier are wired to production sessions, enrollment
 * and authentication fail closed. This module does not persist or synthesize credentials.
 */

export interface PasskeyCredentialRecord {
  id: string; userId: string; userEmail: string; userName: string;
  userRole: 'cashier' | 'manager' | 'admin'; deviceLabel: string;
  authenticatorType: 'touch_id' | 'face_id' | 'windows_hello' | 'android_biometric' | 'security_key' | 'virtual_biometric';
  createdAt: string; lastUsedAt?: string; counter: number; isVirtualFallback?: boolean;
}
export interface WebAuthnCapability {
  isSupported: boolean; hasPlatformAuthenticator: boolean; isConditionalMediationAvailable: boolean;
  biometricLabel: string; platformSummary: string;
}
export interface WebAuthnChallengeRecord {
  challengeId: string; challenge: string; rpId: string; origin: string; issuedAt: number;
  expiresAt: number; used: boolean; targetUserId?: string; targetUserEmail?: string;
}
export interface WebAuthnAssertionPayload {
  challengeId: string; credentialId: string; clientDataJSON: string; authenticatorData: string;
  signature: string; userHandle?: string; authenticatorType: PasskeyCredentialRecord['authenticatorType'];
  authMethod: 'hardware_biometric' | 'virtual_passkey';
}
export interface WebAuthnVerificationResult {
  verified: boolean; credential?: PasskeyCredentialRecord; challengeId?: string; signCount?: number;
  userPresent?: boolean; userVerified?: boolean; origin?: string; rpId?: string;
  authMethod?: 'hardware_biometric' | 'virtual_passkey'; error?: string;
}
const DISABLED_MESSAGE = 'Passkey authentication is unavailable until server-side WebAuthn verification is configured.';

export function bufferToBase64URL(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer); let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function base64URLToBuffer(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export function stringToBase64URL(value: string): string {
  return bufferToBase64URL(new TextEncoder().encode(value).buffer as ArrayBuffer);
}
export function base64URLToString(value: string): string {
  return new TextDecoder().decode(base64URLToBuffer(value));
}
export function detectBiometricLabel(): { type: PasskeyCredentialRecord['authenticatorType']; label: string } {
  if (typeof navigator === 'undefined') return { type: 'security_key', label: 'Platform authenticator' };
  const ua = navigator.userAgent.toLowerCase(); const platform = navigator.platform?.toLowerCase() || '';
  if (/iphone|ipad|ipod/.test(ua)) return { type: 'face_id', label: 'Face ID / Touch ID' };
  if (/macintosh|mac os x/.test(ua) || platform.includes('mac')) return { type: 'touch_id', label: 'Mac Touch ID' };
  if (/windows/.test(ua) || platform.includes('win')) return { type: 'windows_hello', label: 'Windows Hello' };
  if (/android/.test(ua)) return { type: 'android_biometric', label: 'Android biometric' };
  return { type: 'security_key', label: 'Platform or external authenticator' };
}
export async function checkWebAuthnCapability(): Promise<WebAuthnCapability> {
  const isSupported = typeof window !== 'undefined' && window.isSecureContext &&
    typeof window.PublicKeyCredential !== 'undefined' && typeof navigator?.credentials?.get === 'function' &&
    typeof navigator?.credentials?.create === 'function';
  let hasPlatformAuthenticator = false; let isConditionalMediationAvailable = false;
  if (isSupported) {
    try { if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') hasPlatformAuthenticator = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { hasPlatformAuthenticator = false; }
    try {
      const pkc = PublicKeyCredential as typeof PublicKeyCredential & { isConditionalMediationAvailable?: () => Promise<boolean> };
      if (typeof pkc.isConditionalMediationAvailable === 'function') isConditionalMediationAvailable = await pkc.isConditionalMediationAvailable();
    } catch { isConditionalMediationAvailable = false; }
  }
  const { label } = detectBiometricLabel();
  return { isSupported, hasPlatformAuthenticator, isConditionalMediationAvailable, biometricLabel: label,
    platformSummary: isSupported ? `${label} detected; server verification disabled` : 'WebAuthn unavailable; server verification disabled' };
}
export function getRegisteredPasskeys(): PasskeyCredentialRecord[] { return []; }
export function saveRegisteredPasskeys(_keys: PasskeyCredentialRecord[]): void { /* server-owned registry required */ }
export function createWebAuthnChallengeRecord(targetUser?: { id?: string; email?: string }, ttlMs = 60_000): WebAuthnChallengeRecord {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') throw new Error('Secure challenge generation is unavailable.');
  const challenge = crypto.getRandomValues(new Uint8Array(32)); const id = crypto.getRandomValues(new Uint8Array(24));
  const now = Date.now(); const rpId = typeof window !== 'undefined' && window.location?.hostname ? window.location.hostname : 'localhost';
  const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : `https://${rpId}`;
  return { challengeId: bufferToBase64URL(id.buffer as ArrayBuffer), challenge: bufferToBase64URL(challenge.buffer as ArrayBuffer), rpId, origin,
    issuedAt: now, expiresAt: now + ttlMs, used: false, targetUserId: targetUser?.id, targetUserEmail: targetUser?.email };
}
export async function registerPasskey(_user: { id: string; email: string; name: string; role: 'cashier' | 'manager' | 'admin' }, _deviceLabel?: string): Promise<{ success: boolean; credential?: PasskeyCredentialRecord; error?: string; isVirtual?: boolean }> {
  return { success: false, error: DISABLED_MESSAGE, isVirtual: false };
}
export async function authenticatePasskey(_targetUser?: { id: string; email: string; name: string }, _issuedChallenge?: WebAuthnChallengeRecord): Promise<{
  success: boolean; credential?: PasskeyCredentialRecord; assertion?: WebAuthnAssertionPayload; challengeRecord?: WebAuthnChallengeRecord;
  error?: string; authMethod: 'hardware_biometric' | 'virtual_passkey';
}> { return { success: false, error: DISABLED_MESSAGE, authMethod: 'hardware_biometric' }; }
export type PasskeyRevocationReason = 'lost_device' | 'compromised' | 'replaced' | 'manual';
export function renameEnrolledPasskey(_id: string, _newDeviceLabel: string): { updated: PasskeyCredentialRecord[]; target?: PasskeyCredentialRecord; previousLabel?: string } { return { updated: [] }; }
export function revokeEnrolledPasskey(_id: string, _reason: PasskeyRevocationReason = 'lost_device'): { remaining: PasskeyCredentialRecord[]; revoked?: PasskeyCredentialRecord } { return { remaining: [] }; }
export function removeEnrolledPasskey(_id: string): PasskeyCredentialRecord[] { return []; }
export function resetPasskeys(): PasskeyCredentialRecord[] { return []; }
