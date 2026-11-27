import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResultRow } from 'pg';
import { createApp } from './createApp';
import { registerOrderReadRoute } from './order-read-route';
import type { SqlQueryExecutor } from '../db/transaction';

const principal={userId:'user-1',organizationId:'org-1',storeId:'store-authorized',sessionId:'session-1'};
const start=async(app:ReturnType<typeof createApp>)=>{const server=await new Promise<import('node:http').Server>(resolve=>{const instance=app.listen(0,()=>resolve(instance));});const address=server.address();assert.ok(address&&typeof address!=='string');return{baseUrl:`http://127.0.0.1:${address.port}`,close:()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};};

test('order read route is authenticated, permissioned, limited, and store-scoped',async()=>{const queries:Array<{sql:string;parameters:readonly unknown[]}>=[];const query=async<T extends QueryResultRow>(sql:string,parameters:readonly unknown[]=[])=>{queries.push({sql,parameters});if(sql.includes('FROM prodx_orders'))return{rows:[{id:'00000000-0000-4000-8000-000000001010',organization_id:'org-1',store_id:principal.storeId,register_id:'register-1',cashier_id:'user-1',shift_id:'shift-1',order_number:'ORD-1',idempotency_key:'idem-1',status:'server_confirmed',gross_subtotal_amount:'100.00',item_discounts_amount:'0.00',order_discount_amount:'0.00',net_subtotal_amount:'93.46',total_tax_amount:'6.54',grand_total_amount:'100.00',currency:'THB',total_items_count:1,notes:null,created_at:'2026-09-29T10:00:00.000Z',server_committed_at:'2026-09-29T10:00:01.000Z',cashier_name:'Cashier One'}] as unknown as T[]};if(sql.includes('FROM prodx_order_items'))return{rows:[{id:'00000000-0000-4000-8000-000000001011',order_id:'00000000-0000-4000-8000-000000001010',product_id:'00000000-0000-4000-8000-000000001008',store_id:principal.storeId,sku:'SKU-1',barcode:'123',name:'Coffee',category_id:'cat-1',product_price_amount:'100.00',cost_price_amount:'50.00',tax_rate_bps:700,current_stock:9,reorder_point:2,unit_of_measure:'cup',quantity:1,unit_price_amount:'100.00',item_discount_bps:0,line_subtotal_amount:'93.46',line_tax_amount:'6.54',line_total_amount:'100.00',currency:'THB'}] as unknown as T[]};if(sql.includes('FROM prodx_payments'))return{rows:[{id:'00000000-0000-4000-8000-000000001012',order_id:'00000000-0000-4000-8000-000000001010',method:'cash',amount:'100.00',tendered_cash:'100.00',change_given:'0.00',auth_code:null,card_last_four:null,terminal_reference:null,currency:'THB',created_at:'2026-09-29T10:00:01.000Z'}] as unknown as T[]};if(sql.includes('FROM prodx_refund_items'))return{rows:[] as unknown as T[]};if(sql.includes('FROM prodx_refunds'))return{rows:[] as unknown as T[]};throw new Error(`Unexpected SQL: ${sql}`);};const db:SqlQueryExecutor={query};const app=createApp({authenticateRequest:()=>principal,authorizeRequest:(_context,permission)=>permission==='pos.sell',configureRoutes:configuredApp=>registerOrderReadRoute(configuredApp,db)});const server=await start(app);try{const response=await fetch(`${server.baseUrl}/api/v1/orders?limit=25`);const responseBody=await response.json() as any;assert.equal(response.status,200,JSON.stringify(responseBody));const orders=responseBody as any[];assert.equal(orders.length,1);assert.equal(orders[0].storeId,principal.storeId);assert.equal(orders[0].totals.grandTotal.amountInCents,10000);assert.equal(orders[0].payments[0].amount.amountInCents,10000);const orderQuery=queries.find(q=>q.sql.includes('FROM prodx_orders'));assert.deepEqual(orderQuery?.parameters,['org-1',principal.storeId,25,0]);}finally{await server.close();}});

test('order read route strictly filters by registerId when requested', async () => {
  const queries: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const query = async <T extends QueryResultRow>(sql: string, parameters: readonly unknown[] = []) => {
    queries.push({ sql, parameters });
    if (sql.includes('FROM prodx_orders')) {
      return { rows: [] as unknown as T[] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const db: SqlQueryExecutor = { query };
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: (_context, permission) => permission === 'pos.sell',
    configureRoutes: (configuredApp) => registerOrderReadRoute(configuredApp, db),
  });
  const server = await start(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/orders?limit=10&registerId=Terminal-001`);
    assert.equal(response.status, 200);
    const orderQuery = queries.find((q) => q.sql.includes('FROM prodx_orders'));
    assert.ok(orderQuery);
    assert.ok(orderQuery.sql.includes('o.register_id = $3'));
    assert.deepEqual(orderQuery.parameters, ['org-1', principal.storeId, 'Terminal-001', 10, 0]);
  } finally {
    await server.close();
  }
});

test('order read route fails closed when permission is denied', async () => {
  const db: SqlQueryExecutor = {
    query: async () => {
      throw new Error('database must not be reached');
    },
  };
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: () => false,
    configureRoutes: (configuredApp) => registerOrderReadRoute(configuredApp, db),
  });
  const server = await start(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/orders`);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'FORBIDDEN');
  } finally {
    await server.close();
  }
});


test('order read route supports bounded store-wide date pagination without register scope', async () => {
  const queries: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const query = async <T extends QueryResultRow>(sql: string, parameters: readonly unknown[] = []) => {
    queries.push({ sql, parameters });
    if (sql.includes('FROM prodx_orders')) return { rows: [] as unknown as T[] };
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const db: SqlQueryExecutor = { query };
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: (_context, permission) => permission === 'pos.sell',
    configureRoutes: (configuredApp) => registerOrderReadRoute(configuredApp, db),
  });
  const server = await start(app);
  try {
    const from = '2026-10-01T00:00:00.000Z';
    const to = '2026-11-20T23:59:59.999Z';
    const response = await fetch(`${server.baseUrl}/api/v1/orders?limit=200&offset=400&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    assert.equal(response.status, 200);
    const orderQuery = queries.find((entry) => entry.sql.includes('FROM prodx_orders'));
    assert.ok(orderQuery);
    assert.match(orderQuery.sql, /o\.organization_id = \$1/);
    assert.match(orderQuery.sql, /o\.store_id = \$2/);
    assert.match(orderQuery.sql, /o\.created_at >= \$3::timestamptz/);
    assert.match(orderQuery.sql, /o\.created_at <= \$4::timestamptz/);
    assert.match(orderQuery.sql, /LIMIT \$5 OFFSET \$6/);
    assert.deepEqual(orderQuery.parameters, ['org-1', principal.storeId, from, to, 200, 400]);
    assert.doesNotMatch(orderQuery.sql, /register_id =/);
  } finally {
    await server.close();
  }
});

test('order read route rejects invalid pagination and date bounds before database access', async () => {
  const db: SqlQueryExecutor = { query: async () => { throw new Error('database must not be reached'); } };
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: (_context, permission) => permission === 'pos.sell',
    configureRoutes: (configuredApp) => registerOrderReadRoute(configuredApp, db),
  });
  const server = await start(app);
  try {
    const invalidOffset = await fetch(`${server.baseUrl}/api/v1/orders?offset=-1`);
    assert.equal(invalidOffset.status, 400);
    assert.equal((await invalidOffset.json()).error.code, 'INVALID_OFFSET');
    const invalidDate = await fetch(`${server.baseUrl}/api/v1/orders?from=not-a-date`);
    assert.equal(invalidDate.status, 400);
    assert.equal((await invalidDate.json()).error.code, 'INVALID_DATE_RANGE');
    const invertedRange = await fetch(`${server.baseUrl}/api/v1/orders?from=2026-11-20T12%3A00%3A00.000Z&to=2026-11-19T12%3A00%3A00.000Z`);
    assert.equal(invertedRange.status, 400);
    assert.equal((await invertedRange.json()).error.code, 'INVALID_DATE_RANGE');
  } finally {
    await server.close();
  }
});
