import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresPool, asSqlExecutor } from '../db/postgres';
import { createPostgresAuthorization } from './production-authorization';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool({ connectionString: databaseUrl, max: 2 }) : null;
const authorize = pool ? createPostgresAuthorization(asSqlExecutor(pool)) : null;

const ids = {
  organization: '00000000-0000-4000-8000-000000000301',
  otherOrganization: '00000000-0000-4000-8000-000000000302',
  store: '00000000-0000-4000-8000-000000000311',
  otherStore: '00000000-0000-4000-8000-000000000312',
  user: '00000000-0000-4000-8000-000000000321',
  otherUser: '00000000-0000-4000-8000-000000000322',
  role: '00000000-0000-4000-8000-000000000331',
  otherRole: '00000000-0000-4000-8000-000000000332',
};

const context = {
  requestId: 'ai-provisioning-integration',
  principal: {
    userId: ids.user,
    organizationId: ids.organization,
    storeId: ids.store,
  },
};

const cleanup = async (): Promise<void> => {
  if (!pool) return;
  await pool.query(
    `DELETE FROM prodx_user_roles
      WHERE organization_id IN ($1, $2)
         OR user_id IN ($3, $4)`,
    [ids.organization, ids.otherOrganization, ids.user, ids.otherUser],
  );
  await pool.query(
    `DELETE FROM prodx_role_permissions
      WHERE organization_id IN ($1, $2)
         OR role_id IN ($3, $4)`,
    [ids.organization, ids.otherOrganization, ids.role, ids.otherRole],
  );
  await pool.query(
    `DELETE FROM prodx_store_memberships
      WHERE organization_id IN ($1, $2)
         OR user_id IN ($3, $4)`,
    [ids.organization, ids.otherOrganization, ids.user, ids.otherUser],
  );
  await pool.query(
    `DELETE FROM prodx_roles
      WHERE organization_id IN ($1, $2) OR id IN ($3, $4)`,
    [ids.organization, ids.otherOrganization, ids.role, ids.otherRole],
  );
  await pool.query(
    `DELETE FROM prodx_users
      WHERE id IN ($1, $2)`,
    [ids.user, ids.otherUser],
  );
  await pool.query(
    `DELETE FROM prodx_stores
      WHERE id IN ($1, $2)`,
    [ids.store, ids.otherStore],
  );
  await pool.query(
    `DELETE FROM prodx_organizations
      WHERE id IN ($1, $2)`,
    [ids.organization, ids.otherOrganization],
  );
};

test('real PostgreSQL tenant provisioning grants ai:use only after an organization/store role is linked', async (t) => {
  if (!pool || !authorize) {
    t.skip('DATABASE_URL is not configured; run server:test:integration with PostgreSQL.');
    return;
  }

  await cleanup();
  t.after(async () => {
    await cleanup();
    await pool.end();
  });

  await pool.query(
    `INSERT INTO prodx_organizations (id, code, name) VALUES
      ($1, 'ai-a', 'AI Provisioning A'),
      ($2, 'ai-b', 'AI Provisioning B')`,
    [ids.organization, ids.otherOrganization],
  );
  await pool.query(
    `INSERT INTO prodx_stores (id, organization_id, code, name, business_timezone) VALUES
      ($1, $3, 'ai-store-a', 'AI Store A', 'Asia/Bangkok'),
      ($2, $4, 'ai-store-b', 'AI Store B', 'Asia/Bangkok')`,
    [ids.store, ids.otherStore, ids.organization, ids.otherOrganization],
  );
  await pool.query(
    `INSERT INTO prodx_users (id, organization_id, username, display_name) VALUES
      ($1, $3, 'ai-user-a', 'AI User A'),
      ($2, $4, 'ai-user-b', 'AI User B')`,
    [ids.user, ids.otherUser, ids.organization, ids.otherOrganization],
  );
  await pool.query(
    `INSERT INTO prodx_store_memberships (organization_id, store_id, user_id)
     VALUES ($1, $2, $3), ($4, $5, $6)`,
    [ids.organization, ids.store, ids.user, ids.otherOrganization, ids.otherStore, ids.otherUser],
  );
  await pool.query(
    `INSERT INTO prodx_roles (id, organization_id, role_key, name)
     VALUES ($1, $2, 'ai-user', 'AI User')`,
    [ids.role, ids.organization],
  );
  await pool.query(
    `INSERT INTO prodx_user_roles (organization_id, user_id, role_id, store_id)
     VALUES ($1, $2, $3, $4)`,
    [ids.organization, ids.user, ids.role, ids.store],
  );

  assert.equal(await authorize(context, 'ai:use'), false);

  await pool.query(
    `INSERT INTO prodx_role_permissions (organization_id, role_id, permission_id)
     SELECT $1, $2, id
       FROM prodx_permissions
      WHERE permission_key = 'ai:use'`,
    [ids.organization, ids.role],
  );

  assert.equal(await authorize(context, 'ai:use'), true);

  const crossTenantContext = {
    ...context,
    principal: {
      ...context.principal,
      organizationId: ids.otherOrganization,
      storeId: ids.otherStore,
      userId: ids.otherUser,
    },
  };
  assert.equal(await authorize(crossTenantContext, 'ai:use'), false);
});
