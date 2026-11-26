import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON, PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/browser';

const baseUrl = () => {
  return (import.meta.env.VITE_AUTH_API_BASE_URL?.trim() || '').replace(/\/$/, '');
};
const requireToken = (token: string) => {
  const value = token.trim();
  if (!value) throw new Error('Authentication session token is required.');
  return value;
};
const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${baseUrl()}${path}`, {
    credentials: 'include',
    ...init,
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message || `Passkey API request failed (${response.status}).`);
  return payload as T;
};
const withBearer = (token: string) => ({ Authorization: `Bearer ${requireToken(token)}` });

export type WebAuthnServerStatus = { enabled: boolean; rpId: string | null; error: string | null };
export type WebAuthnLoginOptions = { challengeId: string; options: PublicKeyCredentialRequestOptionsJSON };
export type WebAuthnRegistrationOptions = { challengeId: string; options: PublicKeyCredentialCreationOptionsJSON; label: string };
export type WebAuthnLoginRequest = { organizationSlug: string; storeCode: string; registerId: string; username: string; requireAdminRole?: boolean };
export type WebAuthnIssuedSession = { token: string; sessionId: string; expiresAt: string };
export type WebAuthnRevocationReason = 'lost_device' | 'compromised' | 'replaced' | 'manual';
export type WebAuthnCredential = { id: string; label: string; transports: string[]; device_type: 'singleDevice' | 'multiDevice'; backed_up: boolean; created_at: string; last_used_at: string | null };

export const webauthnApi = {
  status: () => request<WebAuthnServerStatus>('/auth/webauthn/status'),
  loginOptions: (input: WebAuthnLoginRequest) => request<WebAuthnLoginOptions>('/auth/webauthn/login/options', { method: 'POST', body: JSON.stringify(input) }),
  verifyLogin: (challengeId: string, response: AuthenticationResponseJSON) => request<WebAuthnIssuedSession>('/auth/webauthn/login/verify', { method: 'POST', body: JSON.stringify({ challengeId, response }) }),
  registrationOptions: (token: string, label: string) => request<WebAuthnRegistrationOptions>('/auth/webauthn/registration/options', { method: 'POST', headers: withBearer(token), body: JSON.stringify({ label }) }),
  verifyRegistration: (token: string, challengeId: string, response: RegistrationResponseJSON, label: string) => request<{ registered: boolean }>('/auth/webauthn/registration/verify', { method: 'POST', headers: withBearer(token), body: JSON.stringify({ challengeId, response, label }) }),
  listCredentials: (token: string) => request<WebAuthnCredential[]>('/auth/webauthn/credentials', { headers: withBearer(token) }),
  renameCredential: (token: string, id: string, label: string) => request<void>(`/auth/webauthn/credentials/${encodeURIComponent(id)}`, { method: 'PATCH', headers: withBearer(token), body: JSON.stringify({ label }) }),
  revokeCredential: (token: string, id: string, reason: WebAuthnRevocationReason) => request<void>(`/auth/webauthn/credentials/${encodeURIComponent(id)}`, { method: 'DELETE', headers: withBearer(token), body: JSON.stringify({ reason }) }),
};
