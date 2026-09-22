export type SupervisorAuthorizationRequest = { action: 'refund' | 'void'; orderId: string; supervisorUsername: string; supervisorSecret: string; };

export type SupervisorAuthorizationResponse = { authorizationToken: string; supervisorUserId: string; expiresAt: string; };

const API_BASE_URL = import.meta.env.VITE_AUTH_API_BASE_URL;

export function createProductionSupervisorAuthorizationApi(token: string) {
  return {
    async authorize(request: SupervisorAuthorizationRequest): Promise<SupervisorAuthorizationResponse> {
      if (!token.trim()) throw new Error('Authenticated session token is required for supervisor authorization.');
      if (!API_BASE_URL) throw new Error('Production authentication API is not configured.');
      const response = await fetch(API_BASE_URL.replace(/\/$/, '') + '/api/v1/authorizations/supervisor', {
        method: 'POST', credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + token.trim() },
        body: JSON.stringify(request),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message = body && typeof body === 'object' && 'error' in body
          ? String((body as { error?: { message?: unknown } }).error?.message ?? 'Supervisor authorization failed.')
          : 'Supervisor authorization failed.';
        throw new Error(message);
      }
      return body as SupervisorAuthorizationResponse;
    },
  };
}
