import type { RequestContext } from '../http/types.ts';
import type { SqlExecutor } from './postgres-repository.ts';
import { hasPermission, type AuthorizationSnapshot } from './authorization.ts';

export const createPostgresAuthorization = (db: SqlExecutor) => async (
  context: RequestContext,
  permission: string,
): Promise<boolean> => {
  const rows = await db.query<AuthorizationSnapshot & { permission_key: string }>(
    `SELECT m.user_id AS "userId",
            m.organization_id AS "organizationId",
            m.store_id AS "storeId",
            p.permission_key
       FROM prodx_store_memberships m
       JOIN prodx_user_roles ur
         ON ur.organization_id = m.organization_id
        AND ur.user_id = m.user_id
        AND ur.store_id = m.store_id
        AND ur.active = TRUE
       JOIN prodx_roles r
         ON r.id = ur.role_id
        AND r.organization_id = ur.organization_id
        AND r.active = TRUE
       JOIN prodx_role_permissions rp
         ON rp.organization_id = r.organization_id
        AND rp.role_id = r.id
       JOIN prodx_permissions p
         ON p.id = rp.permission_id
      WHERE m.organization_id = $1
        AND m.store_id = $2
        AND m.user_id = $3
        AND m.active = TRUE
        AND p.permission_key = $4
      LIMIT 1`,
    [context.principal.organizationId, context.principal.storeId, context.principal.userId, permission],
  );
  const row = rows[0];
  if (!row) return false;
  return hasPermission(context, permission, {
    userId: row.userId,
    organizationId: row.organizationId,
    storeId: row.storeId,
    permissions: new Set([row.permission_key]),
  });
};
