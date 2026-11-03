import type { IAuditApi } from './types';
import type { AuditAction, AuditLogEntry, AuditSeverity } from '../domain/audit';

const configuredBaseUrl = (): string | undefined => import.meta.env?.VITE_AUTH_API_BASE_URL;

const requireBaseUrl = (baseUrl?: string): string => {
  const resolved = (baseUrl ?? configuredBaseUrl())?.trim();
  if (!resolved) {
    throw new Error('Production audit API is not configured: VITE_AUTH_API_BASE_URL is missing.');
  }
  return resolved.replace(/\/$/, '');
};

const requireToken = (token: string): string => {
  const normalized = (token || '').trim();
  if (!normalized) {
    throw new Error('Authenticated session token is required for audit operations.');
  }
  return normalized;
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

export const createProductionAuditApi = (token: string, baseUrl?: string): IAuditApi => ({
  async getLogs(_storeId, limit = 50) {
    const authHeader = `Bearer ${requireToken(token)}`;
    const host = requireBaseUrl(baseUrl);
    const params = new URLSearchParams({ limit: String(limit) });
    const response = await fetch(`${host}/api/v1/audit/logs?${params.toString()}`, {
      headers: { Accept: 'application/json', Authorization: authHeader },
      credentials: 'include',
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Audit log fetch failed (${response.status}).`);
    }
    if (!Array.isArray(data)) {
      throw new Error('Audit log API returned an invalid response.');
    }
    return data.map(mapAuditLog);
  },
  async recordEvent(storeId, registerId, userId, userName, action, severity, details) {
    const authHeader = `Bearer ${requireToken(token)}`;
    const host = requireBaseUrl(baseUrl);
    const response = await fetch(`${host}/api/v1/audit/logs`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      credentials: 'include',
      body: JSON.stringify({ storeId, registerId, userId, userName, action, severity, details }),
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Audit event recording failed (${response.status}).`);
    }
    return mapAuditLog(data);
  },
});

