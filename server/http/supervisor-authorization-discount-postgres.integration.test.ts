import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { hashPassword } from '../auth/password';
import { createPostgresPool } from '../db/postgres';
import { assertDisposableTestDatabaseUrl } from '../db/test-database-guard';
import type { SqlQueryExecutor, TransactionalSqlExecutor } from '../db/transaction';
import { createApp } from './createApp';
import { getCurrentRequestContext } from './request-context-storage';
import { registerSupervisorAuthorizationRoute } from './supervisor-authorization-route';

const configuredUrl = process.env.DATABASE_URL?.trim();
const url = configuredUrl
  ? assertDisposableTestDatabaseUrl(configuredUrl, 'Discount supervisor authorization PostgreSQL integration test')
  : undefined;

const startServer = async (app: ReturnType<typeof createApp>) => {
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
};

const createProdxAppRequestExecutor = (pool: Pool): TransactionalSqlExecutor => ({
  query: async <T extends QueryResultRow>(sql: string, parameters: readonly unknown[] = []) => {
    const context = getCurrentRequestContext();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE prodx_app');
      if (context) {
        await client.query(
          "SELECT set_config('app.organization_id', $1, true), set_config('app.store_id', $2, true), set_config('app.user_id', $3, true)",
          [context.principal.organizationId, context.principal.storeId, context.principal.userId],
        );
      }
      const result = await client.query<T>(sql, [...parameters]);
      await client.query('COMMIT');
      return { rows: result.rows };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    } finally {
      client.release();
    }
  },
  transaction: async <T>(work: (tx: SqlQueryExecutor) => Promise<T>): Promise<T> => {
    const context = getCurrentRequestContext();
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE prodx_app');
      if (context) {
        await client.query(
          "SELECT set_config('app.organization_id', $1, true), set_config('app.store_id', $2, true), set_config('app.user_id', $3, true)",
          [context.principal.organizationId, context.principal.storeId, context.principal.userId],
        );
      }
      const result = await work({
        query: async <R extends QueryResultRow>(sql: string, parameters: readonly unknown[] = []) => {
          const res = await client.query<R>(sql, [...parameters]);
          return { rows: res.rows };
        },
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    } finally {
      client.release();
    }
  },
});

test('PostgreSQL discount supervisor route enforces server catalog BigInt totals and FORCE RLS on prodx_supervisor_authorizations', async (t) => {
  if (!url) {
    t.skip('DATABASE_URL not configured');
    return;
  }

  const pool = createPostgresPool({ connectionString: url, max: 6 });
  t.after(async () => { await pool.end(); });

  // 1. Verify FORCE ROW LEVEL SECURITY on prodx_supervisor_authorizations
  const rlsRow = (await pool.query(
    `SELECT relrowsecurity, relforcerowsecurity
       FROM pg_class
      WHERE oid = 'public.prodx_supervisor_authorizations'::regclass`,
  )).rows[0];
  assert.deepEqual(rlsRow, { relrowsecurity: true, relforcerowsecurity: true }, 'prodx_supervisor_authorizations must have ENABLE + FORCE ROW LEVEL SECURITY');

  // 2. Seed isolated tenant, store, cashier, supervisor, category, product (10.00 THB), and 1500 bps discount policy
  const ids = {
    org: randomUUID(), store: randomUUID(),
    cashier: randomUUID(), supervisor: randomUUID(),
    cashierRole: randomUUID(), supervisorRole: randomUUID(), register: randomUUID(),
    device: randomUUID(), session: randomUUID(),
    category: randomUUID(), product: randomUUID(),
  };
  const suffix = ids.org.replaceAll('-', '').slice(0, 12);
  const supervisorSecret = 'Manager-BigInt-Secret!99';
  const secretHash = await hashPassword(supervisorSecret);

  await pool.query('INSERT INTO prodx_organizations(id,code,name) VALUES($1,$2,$3)', [
    ids.org, `disc-org-${suffix}`, 'Discount Auth PG Org',
  ]);
  await pool.query("INSERT INTO prodx_stores(id,organization_id,code,name,business_timezone) VALUES($1,$2,$3,$4,'Asia/Bangkok')", [
    ids.store, ids.org, `disc-store-${suffix}`, 'Discount Auth PG Store',
  ]);
  await pool.query(
    `INSERT INTO prodx_users(id,organization_id,username,display_name,status) VALUES
      ($1,$2,$3,'Cashier','active'),
      ($4,$2,$5,'Manager','active')`,
    [ids.cashier, ids.org, `disc-cashier-${suffix}`, ids.supervisor, `disc-manager-${suffix}`],
  );
  await pool.query(
    'INSERT INTO prodx_store_memberships(organization_id,store_id,user_id,active) VALUES($1,$2,$3,TRUE),($1,$2,$4,TRUE)',
    [ids.org, ids.store, ids.cashier, ids.supervisor],
  );
  await pool.query(
    "INSERT INTO prodx_roles(id,organization_id,role_key,name,active) VALUES($1,$2,'cashier','Cashier',TRUE),($3,$2,'manager','Manager',TRUE)",
    [ids.cashierRole, ids.org, ids.supervisorRole],
  );
  await pool.query(
    `INSERT INTO prodx_role_permissions(organization_id,role_id,permission_id)
     SELECT $1::uuid, $2::uuid, id FROM prodx_permissions WHERE permission_key = 'pos.discount'
     UNION ALL
     SELECT $1::uuid, $3::uuid, id FROM prodx_permissions WHERE permission_key = 'pos.discount.approve'`,
    [ids.org, ids.cashierRole, ids.supervisorRole],
  );
  await pool.query(
    'INSERT INTO prodx_user_roles(organization_id,user_id,role_id,store_id,active) VALUES($1,$2,$3,$4,TRUE),($1,$5,$6,$4,TRUE)',
    [ids.org, ids.cashier, ids.cashierRole, ids.store, ids.supervisor, ids.supervisorRole],
  );
  await pool.query(
    "INSERT INTO prodx_user_credentials(user_id,credential_type,secret_hash) VALUES($1,'password',$2)",
    [ids.supervisor, secretHash],
  );
  await pool.query('INSERT INTO prodx_registers(id,organization_id,store_id,code,name) VALUES($1,$2,$3,$4,$5)', [
    ids.register, ids.org, ids.store, `DISC-R-${suffix}`, 'Discount Register',
  ]);
  await pool.query("INSERT INTO prodx_devices(id,organization_id,store_id,device_key,name,status) VALUES($1,$2,$3,$4,'POS Terminal','active')", [
    ids.device, ids.org, ids.store, `DISC-DEV-${suffix}`,
  ]);
  await pool.query(
    "INSERT INTO prodx_sessions(id,organization_id,user_id,device_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP + interval '1 hour')",
    [ids.session, ids.org, ids.cashier, ids.device, `${ids.session.replaceAll('-', '')}${ids.org.replaceAll('-', '')}`],
  );
  await pool.query('INSERT INTO prodx_categories(id,organization_id,store_id,name,slug) VALUES($1,$2,$3,$4,$5)', [
    ids.category, ids.org, ids.store, 'Discount Cat', `disc-cat-${suffix}`,
  ]);
  await pool.query(
    "INSERT INTO prodx_products(id,organization_id,store_id,category_id,sku,barcode,name,price_amount,cost_price_amount,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure,active) VALUES($1,$2,$3,$4,$5,$5,'Server Priced Item',10.00,4.00,'THB',0,50,1,'each',TRUE)",
    [ids.product, ids.org, ids.store, ids.category, `DISC-${suffix}`],
  );

  const db = createProdxAppRequestExecutor(pool);
  const app = createApp({
    authenticateRequest: () => ({
      userId: ids.cashier,
      organizationId: ids.org,
      storeId: ids.store,
      sessionId: ids.session,
    }),
    authorizeRequest: (_context, permission) => permission === 'pos.discount',
    configureRoutes: (configuredApp) => registerSupervisorAuthorizationRoute(configuredApp, db),
  });
  const server = await startServer(app);
  try {
    // A. Tampered client totals claiming 50% discount on an actual 5% catalog discount -> MUST reject with 403
    const inflatedRes = await fetch(`${server.baseUrl}/api/v1/authorizations/supervisor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'discount',
        supervisorUsername: `disc-manager-${suffix}`,
        supervisorSecret,
        checkout: {
          idempotencyKey: `disc-tamper-inflated-${suffix}`,
          storeId: ids.store,
          registerId: ids.register,
          cashierId: ids.cashier,
          items: [{
            lineId: 'line-1',
            product: { id: ids.product },
            quantity: 1,
            discountBps: 500,
            unitPrice: { amountInCents: 1000, currency: 'THB' },
            lineSubtotal: { amountInCents: 500, currency: 'THB' },
            lineTax: { amountInCents: 0, currency: 'THB' },
            lineTotal: { amountInCents: 500, currency: 'THB' },
          }],
          totals: {
            grossSubtotal: { amountInCents: 1000, currency: 'THB' },
            itemDiscounts: { amountInCents: 500, currency: 'THB' },
            orderDiscount: { amountInCents: 0, currency: 'THB' },
            netSubtotal: { amountInCents: 500, currency: 'THB' },
            totalTax: { amountInCents: 0, currency: 'THB' },
            grandTotal: { amountInCents: 500, currency: 'THB' },
            totalItemsCount: 1,
          },
          payments: [{
            id: randomUUID(), method: 'cash', amount: { amountInCents: 500, currency: 'THB' },
            tenderedCash: { amountInCents: 500, currency: 'THB' }, changeGiven: { amountInCents: 0, currency: 'THB' },
            timestamp: '2026-11-23T00:00:00.000Z',
          }],
        },
      }),
    });
    assert.equal(inflatedRes.status, 403, 'tampered client totals must not trigger discount authorization for a 5% discount');

    // B. Tampered client totals claiming 1% discount on a combined 10% item + 10% order (19% effective > 15% threshold) -> MUST grant (201)
    const understatedKey = `disc-tamper-understated-${suffix}`;
    const understatedRes = await fetch(`${server.baseUrl}/api/v1/authorizations/supervisor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'discount',
        supervisorUsername: `disc-manager-${suffix}`,
        supervisorSecret,
        checkout: {
          idempotencyKey: understatedKey,
          storeId: ids.store,
          registerId: ids.register,
          cashierId: ids.cashier,
          orderDiscountBps: 1000,
          items: [{
            lineId: 'line-1',
            product: { id: ids.product },
            quantity: 1,
            discountBps: 1000,
            unitPrice: { amountInCents: 1000, currency: 'THB' },
            lineSubtotal: { amountInCents: 990, currency: 'THB' },
            lineTax: { amountInCents: 0, currency: 'THB' },
            lineTotal: { amountInCents: 990, currency: 'THB' },
          }],
          totals: {
            grossSubtotal: { amountInCents: 10000, currency: 'THB' },
            itemDiscounts: { amountInCents: 100, currency: 'THB' },
            orderDiscount: { amountInCents: 0, currency: 'THB' },
            netSubtotal: { amountInCents: 9900, currency: 'THB' },
            totalTax: { amountInCents: 0, currency: 'THB' },
            grandTotal: { amountInCents: 9900, currency: 'THB' },
            totalItemsCount: 1,
          },
          payments: [{
            id: randomUUID(), method: 'cash', amount: { amountInCents: 9900, currency: 'THB' },
            tenderedCash: { amountInCents: 9900, currency: 'THB' }, changeGiven: { amountInCents: 0, currency: 'THB' },
            timestamp: '2026-11-23T00:00:00.000Z',
          }],
        },
      }),
    });
    assert.equal(understatedRes.status, 201, 'authoritative server BigInt 19% effective discount must grant supervisor approval even when client totals claim 1%');
    const grantBody = await understatedRes.json() as { authorizationToken: string; supervisorUserId: string };
    assert.equal(grantBody.supervisorUserId, ids.supervisor);
    assert.ok(grantBody.authorizationToken.length >= 40);

    const authRows = (await pool.query(
      'SELECT checkout_idempotency_key, policy_threshold_bps FROM prodx_supervisor_authorizations WHERE organization_id=$1 AND store_id=$2',
      [ids.org, ids.store],
    )).rows;
    assert.equal(authRows.length, 1);
    assert.equal(authRows[0].checkout_idempotency_key, understatedKey);
    assert.equal(Number(authRows[0].policy_threshold_bps), 1500);
  } finally {
    await server.close();
  }
});
