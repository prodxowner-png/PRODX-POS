import type { IAuditApi } from './types';
import type { AuditAction, AuditLogEntry, AuditSeverity } from '../domain/audit';

const API_BASE_URL = import.meta.env.VITE_AUTH_API_BASE_URL ?? '';

const requireToken = (token: string): string => {
  if (!token?.trim()) throw new Error('Production audit API requires an authenticated session token.');
  return token.trim();
};

const mapAuditLog = (value: unknown): AuditLogEntry => {
  if (!value || typeof value !== 'object') throw new Error('Invalid audit log response.');
  const row = value as Record<string, unknown>;
  return {
    id: String(row.id),
    storeId: String(row.storeId),
    registerId: String(row.registerId ?? ''),
    userId: String(row.userId),
    userName: String(row.userName ?? ''),
    action: String(row.action) as AuditAction,
    severity: String(row.severity) as AuditSeverity,
    details: (row.details && typeof row.details === 'object' ? row.details : {}) as Record<string, unknown>,
    timestamp: String(row.timestamp),
  };
};

export const createProductionAuditApi = (token: string): IAuditApi => ({
  async getLogs(_storeId, limit = 50) {
    const params = new URLSearchParams({ limit: String(limit) });
    const response = await fetch(`${API_BASE_URL}/api/v1/audit/logs?${params.toString()}`, {
      headers: { Authorization: `Bearer ${requireToken(token)}` },
      credentials: 'include',
    });
    if (!response.ok) throw new Error(`Audit API request failed: HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error('Invalid audit log response.');
    return data.map(mapAuditLog);
  },

  async recordEvent() {
    throw new Error('Production audit event writes are server-owned and are not exposed as a client API.');
  },
});
