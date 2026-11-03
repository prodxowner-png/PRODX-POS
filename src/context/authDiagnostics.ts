export interface AuthDiagnosticRequest {
  organizationSlug?: string;
  storeCode?: string;
  registerId?: string;
  emailOrPin?: string;
  requireAdminRole?: boolean;
}

/** Return only non-secret authentication metadata suitable for diagnostic logs. */
export const createAuthDiagnosticRequest = (request: AuthDiagnosticRequest) => ({
  org: request.organizationSlug || '',
  branch: request.storeCode || '',
  terminal: request.registerId || '',
  identityType: request.emailOrPin?.includes('@') ? 'email' : 'staff-identifier',
  identityPresent: Boolean(request.emailOrPin),
  requireAdmin: request.requireAdminRole || false,
});
