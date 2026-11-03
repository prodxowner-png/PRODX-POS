import type { Express, NextFunction, Request, Response } from 'express';
type Permission =
  | 'pos:checkout' | 'pos:discount' | 'pos:price_override' | 'pos:void' | 'pos:refund'
  | 'inventory:read' | 'inventory:adjust'
  | 'shift:open' | 'shift:close' | 'shift:pay_movement'
  | 'customers:read' | 'customers:write'
  | 'reports:read' | 'audit:read' | 'settings:manage'
  | 'org:read' | 'org:manage' | 'branch:manage' | 'terminal:manage' | 'rbac:manage';
import { timingSafeEqual } from 'node:crypto';
import { verifySupabaseToken, type AuthenticatedSession, type SessionIssuer, type SupabaseTokenVerifier } from '../auth/session';
import type { FirstTenantBootstrapConfig } from '../auth/first-tenant-bootstrap';
import type { FirstTenantBootstrapRepository, SqlExecutor } from '../auth/postgres-repository';
import { runWithRequestContext } from './request-context-storage.ts';
import { checkLoginThrottle, recordLoginFailure } from '../auth/login-rate-limit';

type LoginBody = {
  organizationSlug: string;
  storeCode: string;
  emailOrPin: string;
  passwordOrPin: string;
  registerId: string;
  requireAdminRole?: boolean;
};

type Role = 'admin' | 'manager' | 'cashier';

// Store-level commercial defaults are not yet persisted per store. Keep them in
// one place so they can be replaced by a store settings table later.
const DEFAULT_STORE_CURRENCY = 'THB';
const DEFAULT_STORE_TAX_RATE_BPS = 700;
const MAX_FIELD_LENGTH = 256;

const AUTH_FAILED_MESSAGE = 'Invalid credentials or store scope.';
const ADMIN_ROLE_REQUIRED_MESSAGE =
  'Access Denied: Only accounts with the "admin" role can authenticate into the Administrator Console.';

const BACKEND_TO_UI_PERMISSIONS: Record<string, readonly Permission[]> = {
  'pos.sell': ['pos:checkout'],
  'pos.discount': ['pos:discount'],
  'pos.price_override': ['pos:price_override'],
  'pos.void': ['pos:void'],
  'pos.refund': ['pos:refund'],
  'inventory.read': ['inventory:read'],
  'inventory.adjust': ['inventory:adjust'],
  'cash.shift.open': ['shift:open'],
  'cash.shift.close': ['shift:close'],
  'cash.shift.movement': ['shift:pay_movement'],
  'customer.read': ['customers:read'],
  'customer.write': ['customers:write'],
  'report.read': ['reports:read'],
  'reports.read': ['reports:read'],
  'dashboard.read': ['reports:read'],
  'audit.read': ['audit:read'],
  'settings.manage': ['settings:manage'],
  'users.read': ['org:read'],
  'org.read': ['org:read'],
  'users.manage': ['org:manage', 'branch:manage', 'terminal:manage', 'settings:manage'],
  'org.manage': ['org:manage'],
  'branch.manage': ['branch:manage'],
  'terminal.manage': ['terminal:manage'],
  'rbac.manage': ['rbac:manage', 'org:manage', 'branch:manage', 'terminal:manage', 'settings:manage'],
};

const toUiPermissions = (permissionKeys: readonly string[], role: Role): Permission[] => {
  const mapped = new Set<Permission>();
  for (const key of permissionKeys) {
    const uiPerms = BACKEND_TO_UI_PERMISSIONS[key];
    if (uiPerms) {
      for (const perm of uiPerms) mapped.add(perm);
    }
  }
  if (role === 'admin' && (permissionKeys.includes('rbac.manage') || permissionKeys.includes('users.manage'))) {
    mapped.add('org:read');
    mapped.add('org:manage');
    mapped.add('branch:manage');
    mapped.add('terminal:manage');
    mapped.add('rbac:manage');
    mapped.add('settings:manage');
  }
  return Array.from(mapped);
};

const errorBody = (request: Request, code: string, message: string) => ({
  error: { code, message, requestId: request.id },
});

const sendUnauthenticated = (request: Request, response: Response, message = 'Authentication is required.'): void => {
  response.status(401).json(errorBody(request, 'UNAUTHENTICATED', message));
};

const sendAuthFailed = (request: Request, response: Response, message = AUTH_FAILED_MESSAGE): void => {
  response.status(401).json(errorBody(request, 'AUTHENTICATION_FAILED', message));
};

const sendAdminRoleRequired = (request: Request, response: Response, message = ADMIN_ROLE_REQUIRED_MESSAGE): void => {
  response.status(403).json(errorBody(request, 'ADMIN_ROLE_REQUIRED', message));
};

const bearerToken = (request: Request): string | null => {
  const header = request.header('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
};

const asyncRoute = (handler: (request: Request, response: Response) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction): void => {
    handler(request, response).catch(next);
  };

const withPrincipalContext = <T>(
  request: Request,
  principal: AuthenticatedSession,
  work: () => Promise<T>,
): Promise<T> => runWithRequestContext({ requestId: request.id, principal }, work);

const isAdminConsoleRegister = (registerId: string): boolean => {
  const normalized = registerId.trim().toUpperCase();
  return normalized === 'ADMIN-CONSOLE' || normalized === 'ADMIN_CONSOLE' || normalized === 'TERM-ADMIN';
};

const readLoginBody = (value: unknown): LoginBody | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const fields = ['organizationSlug', 'storeCode', 'emailOrPin', 'passwordOrPin', 'registerId'] as const;
  const result: Partial<LoginBody> = {};
  for (const field of fields) {
    const raw = body[field];
    if (typeof raw !== 'string') return null;
    const normalized = field === 'passwordOrPin' ? raw : raw.trim();
    if (!normalized || normalized.length > MAX_FIELD_LENGTH) return null;
    result[field] = normalized;
  }
  if (typeof body.requireAdminRole === 'boolean') {
    result.requireAdminRole = body.requireAdminRole;
  }
  return result as LoginBody;
};

// Tenant-scoped Owner accounts intentionally use the existing admin permission contract.
const toRole = (value: string): Role => (value === 'owner' || value === 'admin' || value === 'manager' ? (value === 'owner' ? 'admin' : value) : 'cashier');

const mapStore = (row: { id: string; organization_id: string; code: string; name: string; business_timezone: string }) => ({
  id: row.id,
  organizationId: row.organization_id,
  code: row.code,
  name: row.name,
  address: '',
  phone: '',
  currency: DEFAULT_STORE_CURRENCY,
  timezone: row.business_timezone,
  defaultTaxRateBps: DEFAULT_STORE_TAX_RATE_BPS,
});

const loadSessionContext = async (
  db: SqlExecutor,
  principal: AuthenticatedSession,
  token: string,
  expiresAt: Date,
) => {
  const rows = await db.query<{
    organization_id: string; organization_code: string; organization_name: string;
    store_id: string; store_code: string; store_name: string; business_timezone: string;
    user_id: string; username: string; display_name: string; role_key: string;
    device_key: string;
  }>(
    `SELECT o.id AS organization_id, o.code AS organization_code, o.name AS organization_name,
            s.id AS store_id, s.code AS store_code, s.name AS store_name, s.business_timezone,
            u.id AS user_id, u.username, u.display_name,
            COALESCE(r.role_key, 'cashier') AS role_key,
            d.device_key
       FROM prodx_sessions ses
       JOIN prodx_organizations o ON o.id = ses.organization_id
       JOIN prodx_devices d ON d.id = ses.device_id AND d.organization_id = o.id AND d.status = 'active'
       JOIN prodx_stores s ON s.organization_id = o.id AND s.id = d.store_id AND s.active = TRUE
       JOIN prodx_users u ON u.organization_id = o.id AND u.id = ses.user_id AND u.status = 'active'
       JOIN prodx_store_memberships m ON m.organization_id = o.id AND m.store_id = s.id AND m.user_id = u.id AND m.active = TRUE
       LEFT JOIN prodx_user_roles ur ON ur.organization_id = o.id AND ur.store_id = s.id AND ur.user_id = u.id AND ur.active = TRUE
       LEFT JOIN prodx_roles r ON r.organization_id = o.id AND r.id = ur.role_id AND r.active = TRUE
      WHERE ses.id = $1 AND ses.organization_id = $2 AND d.store_id = $3 AND ses.user_id = $4
      ORDER BY CASE r.role_key WHEN 'owner' THEN 0 WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END
      LIMIT 1`,
    [principal.sessionId, principal.organizationId, principal.storeId, principal.userId],
  );
  const row = rows[0];
  if (!row) return null;
  const permissions = await db.query<{ permission_key: string }>(
    `SELECT DISTINCT p.permission_key FROM prodx_role_permissions rp
       JOIN prodx_permissions p ON p.id = rp.permission_id
       JOIN prodx_roles r ON r.id = rp.role_id AND r.organization_id = rp.organization_id AND r.active = TRUE
       JOIN prodx_user_roles ur ON ur.organization_id = rp.organization_id AND ur.role_id = rp.role_id
        AND ur.store_id = $2 AND ur.user_id = $3 AND ur.active = TRUE
      WHERE rp.organization_id = $1
      ORDER BY p.permission_key`,
    [principal.organizationId, principal.storeId, principal.userId],
  );
  const resolvedRole = toRole(row.role_key);
  return {
    organization: { id: row.organization_id, name: row.organization_name, slug: row.organization_code, stores: [] },
    currentStore: mapStore({
      id: row.store_id, organization_id: row.organization_id, code: row.store_code,
      name: row.store_name, business_timezone: row.business_timezone,
    }),
    registerId: row.device_key,
    currentUser: {
      id: row.user_id,
      name: row.display_name,
      email: row.username,
      role: resolvedRole,
      employeeCode: row.username,
      permissions: toUiPermissions(permissions.map((p) => p.permission_key), resolvedRole),
    },
    token,
    expiresAt: expiresAt.toISOString(),
  };
};

/**
 * Public authentication routes. These are mounted before the global
 * authentication middleware because /auth/login must accept anonymous
 * requests; routes that need a session validate the bearer token themselves
 * through the same SessionIssuer used by the global middleware.
 */
export type AuthRouteOptions = {
  firstTenantBootstrap?: {
    config: FirstTenantBootstrapConfig | null;
    repository: FirstTenantBootstrapRepository;
    verifySupabaseIdentity?: SupabaseTokenVerifier;
  };
};

export const registerAuthRoutes = (
  app: Express,
  db: SqlExecutor,
  sessions: SessionIssuer,
  options: AuthRouteOptions = {},
): void => {
  app.post('/auth/supabase/bootstrap', asyncRoute(async (request, response) => {
    const bootstrap = options.firstTenantBootstrap;
    const config = bootstrap?.config;
    if (!bootstrap || !config) {
      response.status(404).json(errorBody(request, 'NOT_FOUND', 'Not found.'));
      return;
    }

    const supabaseToken = bearerToken(request);
    const suppliedSecret = request.header('x-prodx-bootstrap-secret') ?? '';
    const expectedBytes = Buffer.from(config.secret, 'utf8');
    const suppliedBytes = Buffer.from(suppliedSecret, 'utf8');
    const secretMatches = expectedBytes.length === suppliedBytes.length
      && timingSafeEqual(expectedBytes, suppliedBytes);
    if (!supabaseToken || !secretMatches) {
      sendUnauthenticated(request, response, 'Bootstrap authorization is invalid.');
      return;
    }

    const verifyIdentity = bootstrap.verifySupabaseIdentity ?? verifySupabaseToken;
    const verified = await verifyIdentity(supabaseToken);
    if (!verified || verified.userId.toLowerCase() !== config.supabaseUserId) {
      sendUnauthenticated(request, response, 'Bootstrap authorization is invalid.');
      return;
    }

    const provisioned = await bootstrap.repository.bootstrapFirstTenant({
      supabaseUserId: verified.userId,
      organizationCode: config.organizationCode,
      organizationName: config.organizationName,
      storeCode: config.storeCode,
      storeName: config.storeName,
      businessTimezone: config.businessTimezone,
      ownerUsername: config.ownerUsername,
      ownerDisplayName: config.ownerDisplayName,
      deviceKey: config.deviceKey,
      deviceName: config.deviceName,
    });
    if (!provisioned) {
      sendAuthFailed(request, response, 'First-tenant bootstrap could not be completed.');
      return;
    }

    const issued = await sessions.authenticateSupabaseToken({
      token: supabaseToken,
      deviceId: provisioned.deviceId,
    });
    if (!issued) {
      sendAuthFailed(request, response, 'First-tenant session could not be established.');
      return;
    }
    const principal = await sessions.authenticateBearer(issued.token);
    if (!principal || principal.organizationId !== provisioned.organizationId
        || principal.userId !== provisioned.userId || principal.storeId !== provisioned.storeId) {
      await sessions.revokeBearer(issued.token);
      sendAuthFailed(request, response, 'First-tenant session scope is invalid.');
      return;
    }
    const context = await withPrincipalContext(request, principal, () =>
      loadSessionContext(db, principal, issued.token, issued.expiresAt));
    if (!context || context.currentUser.role !== 'admin') {
      await sessions.revokeBearer(issued.token);
      sendAdminRoleRequired(request, response);
      return;
    }

    response.setHeader('Cache-Control', 'private, no-store');
    response.status(200).json(context);
  }));

  app.post('/auth/supabase/session', asyncRoute(async (request, response) => {
    const token = bearerToken(request);
    if (!token) { sendUnauthenticated(request, response); return; }
    const body = request.body as Record<string, unknown> | null;
    const organizationSlug = typeof body?.organizationSlug === 'string' ? body.organizationSlug.trim() : '';
    const storeCode = typeof body?.storeCode === 'string' ? body.storeCode.trim() : '';
    const registerId = typeof body?.registerId === 'string' ? body.registerId.trim() : '';
    const requireAdminRole = body?.requireAdminRole === true || isAdminConsoleRegister(registerId);
    if (!organizationSlug || !storeCode || !registerId) {
      response.status(400).json(errorBody(request, 'AUTH_REQUEST_INVALID', 'organizationSlug, storeCode, and registerId are required.'));
      return;
    }
    const devices = await db.query<{ id: string; store_id: string }>(
      `SELECT id, store_id FROM public.prodx_auth_resolve_device($1, $2, $3)`,
      [organizationSlug, storeCode, registerId],
    );
    const device = devices[0];
    if (!device) { sendAuthFailed(request, response); return; }
    const issued = await sessions.authenticateSupabaseToken({ token, deviceId: device.id });
    if (!issued) { sendAuthFailed(request, response); return; }
    const principal = await sessions.authenticateBearer(issued.token);
    if (!principal || principal.storeId !== device.store_id) {
      await sessions.revokeBearer(issued.token);
      sendAuthFailed(request, response);
      return;
    }
    const context = await withPrincipalContext(request, principal, () => loadSessionContext(db, principal, issued.token, issued.expiresAt));
    if (!context) {
      await sessions.revokeBearer(issued.token);
      sendAuthFailed(request, response, 'Session scope could not be established.');
      return;
    }
    if (requireAdminRole && context.currentUser.role !== 'admin') {
      await sessions.revokeBearer(issued.token);
      sendAdminRoleRequired(request, response);
      return;
    }
    response.status(200).json(context);
  }));

  const handleCredentialLogin = (forceAdminRole: boolean) => async (request: Request, response: Response): Promise<void> => {
    const body = readLoginBody(request.body);
    if (!body) {
      response.status(400).json(errorBody(
        request,
        'AUTH_REQUEST_INVALID',
        'organizationSlug, storeCode, emailOrPin, passwordOrPin, and registerId are required strings.',
      ));
      return;
    }

    const throttle = await checkLoginThrottle(db, request.ip || 'unknown');
    if (!throttle.allowed) {
      if (throttle.retryAfterSeconds) response.setHeader('retry-after', String(throttle.retryAfterSeconds));
      response.status(429).json(errorBody(request, 'AUTH_RATE_LIMITED', 'Too many failed authentication attempts. Please try again later.'));
      return;
    }

    const devices = await db.query<{ id: string; store_id: string }>(
      `SELECT id, store_id FROM public.prodx_auth_resolve_device($1, $2, $3)`,
      [body.organizationSlug, body.storeCode, body.registerId],
    );
    const device = devices[0];
    if (!device) { await recordLoginFailure(db, request.ip || 'unknown'); sendAuthFailed(request, response); return; }

    const issued = await sessions.authenticateCredentials({
      username: body.emailOrPin,
      password: body.passwordOrPin,
      deviceId: device.id,
    });
    if (!issued) { await recordLoginFailure(db, request.ip || 'unknown'); sendAuthFailed(request, response); return; }

    const principal = await sessions.authenticateBearer(issued.token);
    if (!principal || principal.storeId !== device.store_id) {
      await sessions.revokeBearer(issued.token);
      sendAuthFailed(request, response);
      return;
    }

    const context = await withPrincipalContext(request, principal, () => loadSessionContext(db, principal, issued.token, issued.expiresAt));
    if (!context) {
      await sessions.revokeBearer(issued.token);
      sendAuthFailed(request, response, 'Session scope could not be established.');
      return;
    }

    const requiresAdmin = forceAdminRole || body.requireAdminRole === true || isAdminConsoleRegister(body.registerId);
    if (requiresAdmin && context.currentUser.role !== 'admin') {
      await sessions.revokeBearer(issued.token);
      sendAdminRoleRequired(request, response);
      return;
    }

    response.status(200).json(context);
  };

  app.post('/auth/login', asyncRoute(handleCredentialLogin(false)));
  app.post('/auth/admin/login', asyncRoute(handleCredentialLogin(true)));

  app.post('/auth/logout', asyncRoute(async (request, response) => {
    const token = bearerToken(request);
    if (!token) { sendUnauthenticated(request, response); return; }
    if (!(await sessions.revokeBearer(token))) {
      sendUnauthenticated(request, response, 'Authentication session is invalid.');
      return;
    }
    response.status(204).send();
  }));

  app.get('/auth/session', asyncRoute(async (request, response) => {
    const token = bearerToken(request);
    if (!token) { sendUnauthenticated(request, response); return; }
    const principal = await sessions.authenticateBearer(token);
    if (!principal) { sendUnauthenticated(request, response, 'Authentication session is invalid.'); return; }
    const context = await withPrincipalContext(request, principal, async () => {
      const sessionRows = await db.query<{ expires_at: Date }>(
        `SELECT expires_at FROM public.prodx_sessions WHERE id = $1 AND revoked_at IS NULL LIMIT 1`,
        [principal.sessionId],
      );
      const expiresAt = sessionRows[0]?.expires_at;
      if (!expiresAt) return null;
      return loadSessionContext(db, principal, token, expiresAt);
    });
    if (!context) { sendUnauthenticated(request, response, 'Authentication session is invalid.'); return; }
    response.json(context);
  }));

  app.get('/organizations/:orgSlug/stores', asyncRoute(async (request, response) => {
    const token = bearerToken(request);
    if (!token) { sendUnauthenticated(request, response); return; }
    const principal = await sessions.authenticateBearer(token);
    if (!principal) { sendUnauthenticated(request, response, 'Authentication session is invalid.'); return; }
    const rows = await withPrincipalContext(request, principal, () =>
      db.query<{ id: string; organization_id: string; code: string; name: string; business_timezone: string }>(
        `SELECT id, organization_id, code, name, business_timezone
           FROM public.prodx_auth_list_member_stores($1)
          ORDER BY code`,
        [request.params.orgSlug],
      ));
    response.json(rows.map(mapStore));
  }));
};
