import type { Role, User } from '../domain/auth';

const API_BASE_URL = import.meta.env.VITE_AUTH_API_BASE_URL;

type SupervisorDirectoryRow = { id: string; email: string; name: string; role: string };

export function createProductionSupervisorDirectoryApi(token: string) {
  return {
    async list(): Promise<User[]> {
      if (!token.trim()) throw new Error('Authenticated session token is required to load supervisors.');
      if (!API_BASE_URL) throw new Error('Production authentication API is not configured.');
      const response = await fetch(API_BASE_URL.replace(/\/$/, '') + '/api/v1/authorizations/supervisors', {
        method: 'GET', credentials: 'include', headers: { Accept: 'application/json', Authorization: `Bearer ${token.trim()}` },
      });
      const body = await response.json().catch(() => null) as { supervisors?: unknown; error?: { message?: unknown } } | null;
      if (!response.ok) throw new Error(String(body?.error?.message ?? 'Unable to load eligible supervisors.'));
      if (!Array.isArray(body?.supervisors)) throw new Error('Supervisor directory response is invalid.');
      return (body.supervisors as SupervisorDirectoryRow[]).filter((row) => row && typeof row.id === 'string' && typeof row.email === 'string' && typeof row.name === 'string' && (row.role === 'owner' || row.role === 'admin' || row.role === 'manager'))
        .map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          role: (row.role === 'owner' ? 'admin' : row.role) as Role,
          employeeCode: row.email,
          permissions: [],
          isActive: true,
        }));
    },
  };
}
