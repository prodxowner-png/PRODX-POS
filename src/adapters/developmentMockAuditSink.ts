import type { AuditLogEntry } from '../domain/audit';

export const developmentAuditLogs: AuditLogEntry[] = [];

export function recordDevelopmentLoginAudit(input: {
  storeId: string;
  registerId: string;
  userId: string;
  userName: string;
  role: string;
  employeeCode?: string;
  organizationSlug: string;
  storeCode: string;
}): void {
  developmentAuditLogs.unshift({
    id: `aud-dev-login-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    storeId: input.storeId,
    registerId: input.registerId,
    userId: input.userId,
    userName: input.userName,
    action: 'user_login',
    severity: 'info',
    details: {
      role: input.role,
      employeeCode: input.employeeCode,
      organizationSlug: input.organizationSlug,
      storeCode: input.storeCode,
      registerId: input.registerId,
    },
    timestamp: new Date().toISOString(),
  });
}
