import type { Express, Request, Response } from 'express';
import type { SessionIssuer } from '../auth/session';
import type { SqlExecutor } from '../auth/postgres-repository';

type LoginBody = {
  organizationSlug: string;
  storeCode: string;
  emailOrPin: string;
  passwordOrPin?: string;
  registerId: string;
};

const errorBody = (request: Request, code: string, message: string) => ({
  error: { code, message, requestId: request.id },
});

const loadSessionContext = async (db: SqlExecutor, principal: { organizationId: string; storeId: string; userId: string; sessionId: string }, token: string, expiresAt: string) => {
  const rows = await db.query<{
    organization_id: string; organization_code: string; organization_name: string;
    store_id: string; store_code: string; store_name: string; business_timezone: string;
    user_id: string; username: string; display_name: string; role_key: string;
  }>(
    `SELECT o.id AS organization_id, o.code AS organization_code, o.name AS organization_name,
            s.id AS store_id, s.code AS store_code, s.name AS store_name, s.business_timezone,
            u.id AS user_id, u.username, u.display_name,
            COALESCE(r.role_key, 'cashier') AS role_key
       FROM prodx_organizations o
       JOIN prodx_stores s ON s.organization_id=o.id AND s.id=$2 AND s.active=TRUE
       JOIN prodx_users u ON u.organization_id=o.id AND u.id=$3 AND u.status='active'
       JOIN prodx_store_memberships m ON m.organization_id=o.id AND m.store_id=s.id AND m.user_id=u.id AND m.active=TRUE
       LEFT JOIN prodx_user_roles ur ON ur.organization_id=o.id AND ur.store_id=s.id AND ur.user_id=u.id AND ur.active=TRUE
       LEFT JOIN prodx_roles r ON r.organization_id=o.id AND r.id=ur.role_id AND r.active=TRUE
      WHERE o.id=$1 LIMIT 1`,
    [principal.organizationId, principal.storeId, principal.userId],
  );
  const row=rows[0];
  if(!row) return null;
  const permissions=await db.query<{permission_key:string}>(
    `SELECT DISTINCT p.permission_key FROM prodx_role_permissions rp
       JOIN prodx_permissions p ON p.id=rp.permission_id
       JOIN prodx_user_roles ur ON ur.organization_id=rp.organization_id AND ur.role_id=rp.role_id
        AND ur.store_id=$2 AND ur.user_id=$3 AND ur.active=TRUE
      WHERE rp.organization_id=$1`,
    [principal.organizationId, principal.storeId, principal.userId],
  );
  return {
    organization:{id:row.organization_id,name:row.organization_name,slug:row.organization_code,stores:[]},
    currentStore:{id:row.store_id,organizationId:row.organization_id,code:row.store_code,name:row.store_name,address:'',phone:'',currency:'THB',timezone:row.business_timezone,defaultTaxRateBps:700},
    registerId:'REGISTER-UNSPECIFIED',
    currentUser:{id:row.user_id,name:row.display_name,email:row.username,role:row.role_key as 'admin'|'manager'|'cashier',employeeCode:row.username,permissions:permissions.map(p=>p.permission_key) as never[]},
    token,expiresAt,
  };
};

export const registerAuthRoutes = (app: Express, db: SqlExecutor, sessions: SessionIssuer): void => {
  app.post('/auth/login', async (request: Request, response: Response) => {
    const body=request.body as Partial<LoginBody>;
    if(!body.organizationSlug || !body.storeCode || !body.emailOrPin || !body.passwordOrPin || !body.registerId) {
      response.status(400).json(errorBody(request,'AUTH_REQUEST_INVALID','organizationSlug, storeCode, emailOrPin, passwordOrPin, and registerId are required.'));
      return;
    }
    const orgRows=await db.query<{id:string;code:string}>(`SELECT id,code FROM prodx_organizations WHERE lower(code)=lower($1) LIMIT 1`,[body.organizationSlug.trim()]);
    const org=orgRows[0];
    if(!org){ response.status(401).json(errorBody(request,'AUTHENTICATION_FAILED','Invalid credentials or store scope.')); return; }
    const storeRows=await db.query<{id:string;code:string}>(`SELECT id,code FROM prodx_stores WHERE organization_id=$1 AND lower(code)=lower($2) AND active=TRUE LIMIT 1`,[org.id,body.storeCode.trim()]);
    const store=storeRows[0];
    const device=store ? await db.query<{id:string;store_id:string;status:string}>(`SELECT id,store_id,status FROM prodx_devices WHERE organization_id=$1 AND store_id=$2 AND device_key=$3 LIMIT 1`,[org.id,store.id,body.registerId.trim()]) : [];
    if(!store || !device[0] || device[0].status!=='active'){ response.status(401).json(errorBody(request,'AUTHENTICATION_FAILED','Invalid credentials or store scope.')); return; }
    const issued=await sessions.authenticateCredentials({username:body.emailOrPin,password:body.passwordOrPin,deviceId:device[0].id});
    if(!issued){ response.status(401).json(errorBody(request,'AUTHENTICATION_FAILED','Invalid credentials or store scope.')); return; }
    const principal=await sessions.authenticateBearer(issued.token);
    if(!principal || principal.storeId!==store.id){ await sessions.revokeBearer(issued.token); response.status(401).json(errorBody(request,'AUTHENTICATION_FAILED','Invalid credentials or store scope.')); return; }
    const context=await loadSessionContext(db,principal,issued.token,issued.expiresAt.toISOString());
    if(!context){ await sessions.revokeBearer(issued.token); response.status(401).json(errorBody(request,'AUTHENTICATION_FAILED','Session scope could not be established.')); return; }
    context.currentStore = {...context.currentStore};
    response.status(200).json(context);
  });

  app.post('/auth/logout', async (request: Request, response: Response) => {
    const header=request.header('authorization');
    if(!header?.startsWith('Bearer ')){ response.status(401).json(errorBody(request,'UNAUTHENTICATED','Authentication is required.')); return; }
    const ok=await sessions.revokeBearer(header.slice(7).trim());
    if(!ok){ response.status(401).json(errorBody(request,'UNAUTHENTICATED','Authentication session is invalid.')); return; }
    response.status(204).send();
  });

  app.get('/auth/session', async (request: Request, response: Response) => {
    const header=request.header('authorization');
    if(!header?.startsWith('Bearer ')){ response.status(401).json(errorBody(request,'UNAUTHENTICATED','Authentication is required.')); return; }
    const token=header.slice(7).trim();
    const principal=await sessions.authenticateBearer(token);
    if(!principal){ response.status(401).json(errorBody(request,'UNAUTHENTICATED','Authentication session is invalid.')); return; }
    const sessionRows=await db.query<{expires_at:Date}>(`SELECT expires_at FROM prodx_sessions WHERE id=$1 AND revoked_at IS NULL LIMIT 1`,[principal.sessionId]);
    const context=await loadSessionContext(db,principal,token,sessionRows[0]?.expires_at.toISOString() ?? new Date(0).toISOString());
    if(!context){ response.status(401).json(errorBody(request,'UNAUTHENTICATED','Authentication session is invalid.')); return; }
    response.json(context);
  });

  app.get('/organizations/:orgSlug/stores', async (request: Request, response: Response) => {
    const header=request.header('authorization');
    if(!header?.startsWith('Bearer ')){ response.status(401).json(errorBody(request,'UNAUTHENTICATED','Authentication is required.')); return; }
    const principal=await sessions.authenticateBearer(header.slice(7).trim());
    if(!principal){ response.status(401).json(errorBody(request,'UNAUTHENTICATED','Authentication session is invalid.')); return; }
    const rows=await db.query<{id:string;organization_id:string;code:string;name:string;business_timezone:string}>(
      `SELECT s.id,s.organization_id,s.code,s.name,s.business_timezone
         FROM prodx_stores s JOIN prodx_organizations o ON o.id=s.organization_id
         JOIN prodx_store_memberships m ON m.organization_id=s.organization_id AND m.store_id=s.id AND m.user_id=$2 AND m.active=TRUE
        WHERE o.id=$1 AND s.active=TRUE ORDER BY s.code`,[principal.organizationId,principal.userId]);
    response.json(rows.map(s=>({id:s.id,organizationId:s.organization_id,code:s.code,name:s.name,address:'',phone:'',currency:'THB',timezone:s.business_timezone,defaultTaxRateBps:700})));
  });
};
