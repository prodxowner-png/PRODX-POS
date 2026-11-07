import assert from 'node:assert/strict';
import test from 'node:test';
import type { CheckoutRequest } from '../../src/adapters/types';
import { CheckoutAuthorizationError, CheckoutConflictError, CheckoutValidationError, checkoutAuthorizationFingerprint, checkoutFingerprint, createCheckoutService } from './checkout-service';
import type { SqlQueryExecutor, TransactionalSqlExecutor } from '../db/transaction';

const request=(overrides:Partial<CheckoutRequest>={}):CheckoutRequest=>({idempotencyKey:'unit-1',storeId:'store-1',registerId:'register-1',cashierId:'user-1',items:[{lineId:'line-1',product:{id:'product-1',storeId:'store-1',sku:'SKU-1',barcode:'BAR-1',name:'Product',categoryId:'cat-1',price:{amountInCents:1000,currency:'THB'},costPrice:{amountInCents:500,currency:'THB'},taxRateBps:0,currentStock:10,reorderPoint:1,unitOfMeasure:'each'},quantity:2,unitPrice:{amountInCents:1000,currency:'THB'},discountBps:0,lineSubtotal:{amountInCents:2000,currency:'THB'},lineTax:{amountInCents:0,currency:'THB'},lineTotal:{amountInCents:2000,currency:'THB'}}],totals:{grossSubtotal:{amountInCents:2000,currency:'THB'},itemDiscounts:{amountInCents:0,currency:'THB'},orderDiscount:{amountInCents:0,currency:'THB'},netSubtotal:{amountInCents:2000,currency:'THB'},totalTax:{amountInCents:0,currency:'THB'},grandTotal:{amountInCents:2000,currency:'THB'},totalItemsCount:2},payments:[{id:'payment-1',method:'cash',amount:{amountInCents:2000,currency:'THB'},tenderedCash:{amountInCents:2000,currency:'THB'},changeGiven:{amountInCents:0,currency:'THB'},timestamp:'2026-09-14T00:00:00.000Z'}],...overrides});
const executor=(query:SqlQueryExecutor['query']):TransactionalSqlExecutor=>({query,transaction:<T>(work:(tx:SqlQueryExecutor)=>Promise<T>)=>work({query})});
const rows=(value:Record<string,unknown>[])=>({rows:value});
const baseDb=(queries:string[]=[]):TransactionalSqlExecutor=>executor(async<T extends Record<string,unknown>>(sql:string)=>{queries.push(sql);if(sql.includes('FROM prodx_orders'))return rows([]) as {rows:T[]};if(sql.includes('FROM prodx_shifts'))return rows([{id:'shift-1'}]) as {rows:T[]};if(sql.includes('FROM prodx_products'))return rows([{id:'product-1',store_id:'store-1',category_id:'cat-1',sku:'SKU-1',barcode:'BAR-1',name:'Product',description:null,price_amount:'10.00',cost_price_amount:'5.00',currency:'THB',tax_rate_bps:0,current_stock:10,reorder_point:1,unit_of_measure:'each',active:true}]) as {rows:T[]};throw new Error(`unexpected query: ${sql}`);});

test('rejects client grand-total tampering before financial writes',async()=>{const q:string[]=[];const db=baseDb(q);await assert.rejects(createCheckoutService(db).checkout(request({totals:{...request().totals,grandTotal:{amountInCents:1,currency:'THB'}}})),(e:unknown)=>e instanceof CheckoutConflictError);assert.equal(q.some(x=>/^INSERT|^UPDATE/.test(x.trimStart())),false);});
test('rejects a grand-total currency mismatch before financial writes',async()=>{const q:string[]=[];const service=createCheckoutService(baseDb(q));await assert.rejects(service.checkout(request({totals:{...request().totals,grandTotal:{amountInCents:2000,currency:'USD'}}})),/Grand total currency/);assert.equal(q.some(x=>/^INSERT|^UPDATE/.test(x.trimStart())),false);});
test('rejects payment currency mismatch and malformed cash',async()=>{const db=baseDb();await assert.rejects(createCheckoutService(db).checkout(request({payments:[{...request().payments[0],amount:{amountInCents:2000,currency:'USD'}}]})),/Payment currency/);await assert.rejects(createCheckoutService(db).checkout(request({payments:[{...request().payments[0],tenderedCash:{amountInCents:2100,currency:'THB'},changeGiven:{amountInCents:0,currency:'THB'}}]})),/Cash tender/);});
test('rejects tendered cash and change currency mismatches before financial writes',async()=>{const q:string[]=[];const service=createCheckoutService(baseDb(q));const payment=request().payments[0];await assert.rejects(service.checkout(request({payments:[{...payment,tenderedCash:{amountInCents:2000,currency:'USD'}}]})),/Tendered cash currency/);await assert.rejects(service.checkout(request({payments:[{...payment,changeGiven:{amountInCents:0,currency:'USD'}}]})),/Change given currency/);assert.equal(q.some(x=>/^INSERT|^UPDATE/.test(x.trimStart())),false);});
test('requires idempotency key and positive items',async()=>{const db=baseDb();await assert.rejects(createCheckoutService(db).checkout(request({idempotencyKey:'   '})),(e:unknown)=>e instanceof CheckoutValidationError);await assert.rejects(createCheckoutService(db).checkout(request({items:[]})),(e:unknown)=>e instanceof CheckoutValidationError);});
test('preserves transaction failures for rollback',async()=>{const db:TransactionalSqlExecutor={query:async()=>({rows:[]}),transaction:async()=>{throw new Error('db failure');}};await assert.rejects(createCheckoutService(db).checkout(request()),/db failure/);});

test('rejects reuse of an idempotency key with a different semantic checkout payload',async()=>{
 const db=executor(async<T extends Record<string,unknown>>(sql:string)=>{
  if(sql.includes('FROM prodx_orders'))return rows([{id:'existing-order',idempotency_payload_hash:'0'.repeat(64)}]) as {rows:T[]};
  throw new Error(`unexpected query: ${sql}`);
 });
 await assert.rejects(createCheckoutService(db).checkout(request()),(error:unknown)=>error instanceof CheckoutConflictError);
});
test('rejects item and order discounts outside the supported basis-point range',async()=>{
 const service=createCheckoutService(baseDb());
 await assert.rejects(service.checkout(request({items:[{...request().items[0],discountBps:10001}]})),(error:unknown)=>error instanceof CheckoutValidationError);
 await assert.rejects(service.checkout(request({orderDiscountBps:-1})),(error:unknown)=>error instanceof CheckoutValidationError);
});


test('validates untrusted checkout structures and safe integer amounts before opening a transaction', async () => {
 let transactionStarted = false;
 const db: TransactionalSqlExecutor = {
  query: async () => ({ rows: [] }),
  transaction: async () => { transactionStarted = true; throw new Error('transaction must not start'); },
 };
 const base = request();
 const malformed = [
  { ...base, items: null },
  { ...base, items: [null] },
  { ...base, items: [{ ...base.items[0], product: null }] },
  { ...base, payments: [null] },
  { ...base, totals: null },
  { ...base, payments: [{ ...base.payments[0], amount: { amountInCents: 1.5, currency: 'THB' } }] },
  { ...base, payments: [{ ...base.payments[0], amount: { amountInCents: Number.MAX_SAFE_INTEGER + 1, currency: 'THB' } }] },
  { ...base, payments: [{ ...base.payments[0], amount: { amountInCents: 1_000_000_000_000, currency: 'THB' } }] },
  { ...base, payments: [{ ...base.payments[0], amount: { amountInCents: '2000', currency: 'THB' } }] },
  { ...base, items: [{ ...base.items[0], quantity: Number.MAX_SAFE_INTEGER + 1 }] },
  { ...base, items: [{ ...base.items[0], quantity: 2_147_483_648 }] },
 ] as unknown as CheckoutRequest[];

 for (const payload of malformed) {
  await assert.rejects(
   createCheckoutService(db).checkout(payload),
   (error: unknown) => error instanceof CheckoutValidationError,
  );
 }
 assert.equal(transactionStarted, false);
});


test('locks product rows in deterministic UUID order for concurrent checkouts',async()=>{
  let lockSql='';
  let lockIds:readonly unknown[]=[];
  const db=executor(async<T extends Record<string,unknown>>(sql:string,parameters:readonly unknown[]=[])=>{
    if(sql.includes('FROM prodx_orders'))return rows([]) as {rows:T[]};
    if(sql.includes('FROM prodx_shifts'))return rows([{id:'shift-1'}]) as {rows:T[]};
    if(sql.includes('FROM prodx_products')){
      lockSql=sql;
      lockIds=parameters[1] as readonly unknown[];
      return rows([
        {id:'product-a',store_id:'store-1',category_id:'cat-1',sku:'SKU-A',barcode:'BAR-A',name:'Product A',description:null,price_amount:'10.00',cost_price_amount:'5.00',currency:'THB',tax_rate_bps:0,current_stock:10,reorder_point:1,unit_of_measure:'each',active:true},
        {id:'product-z',store_id:'store-1',category_id:'cat-1',sku:'SKU-Z',barcode:'BAR-Z',name:'Product Z',description:null,price_amount:'10.00',cost_price_amount:'5.00',currency:'THB',tax_rate_bps:0,current_stock:10,reorder_point:1,unit_of_measure:'each',active:true},
      ]) as {rows:T[]};
    }
    if(sql.includes('INSERT INTO prodx_orders'))return rows([]) as {rows:T[]};
    throw new Error(`unexpected query: ${sql}`);
  });
  const base=request();
  const itemA={...base.items[0],lineId:'line-a',product:{...base.items[0].product,id:'product-a',sku:'SKU-A',barcode:'BAR-A'},quantity:1,lineSubtotal:{amountInCents:1000,currency:'THB'},lineTotal:{amountInCents:1000,currency:'THB'}};
  const itemZ={...base.items[0],lineId:'line-z',product:{...base.items[0].product,id:'product-z',sku:'SKU-Z',barcode:'BAR-Z'},quantity:1,lineSubtotal:{amountInCents:1000,currency:'THB'},lineTotal:{amountInCents:1000,currency:'THB'}};
  await assert.rejects(createCheckoutService(db).checkout(request({items:[itemZ,itemA]})),(e:unknown)=>e instanceof CheckoutConflictError);
  assert.match(lockSql,/ORDER BY id FOR UPDATE/);
  assert.deepEqual(lockIds,['product-a','product-z']);
});

const discountedRequest = (discountBps: number): CheckoutRequest => {
 const base = request();
 const discount = Math.round(2000 * discountBps / 10000);
 const grand = 2000 - discount;
 return {
  ...base,
  items: [{ ...base.items[0], discountBps, lineSubtotal: { amountInCents: grand, currency: 'THB' }, lineTotal: { amountInCents: grand, currency: 'THB' } }],
  totals: {
   grossSubtotal: { amountInCents: 2000, currency: 'THB' },
   itemDiscounts: { amountInCents: discount, currency: 'THB' },
   orderDiscount: { amountInCents: 0, currency: 'THB' },
   netSubtotal: { amountInCents: grand, currency: 'THB' },
   totalTax: { amountInCents: 0, currency: 'THB' },
   grandTotal: { amountInCents: grand, currency: 'THB' },
   totalItemsCount: 2,
  },
  payments: [{ ...base.payments[0], amount: { amountInCents: grand, currency: 'THB' }, tenderedCash: { amountInCents: grand, currency: 'THB' }, changeGiven: { amountInCents: 0, currency: 'THB' } }],
 };
};

const checkoutDb = (discountBps: number, withSupervisor = false, observed: string[] = []): TransactionalSqlExecutor => {
 const payload = discountedRequest(discountBps);
 const discount = Math.round(2000 * discountBps / 10000);
 const grand = 2000 - discount;
 const order = {
  id: 'order-1', order_number: 'ORD-1', idempotency_key: payload.idempotencyKey,
  store_id: payload.storeId, register_id: payload.registerId, cashier_id: payload.cashierId,
  currency: 'THB', status: 'paid', server_committed_at: new Date('2026-11-01T00:00:00Z'), created_at: new Date('2026-11-01T00:00:00Z'),
  gross_subtotal_amount: '20.00', item_discounts_amount: `${Math.floor(discount / 100)}.${String(discount % 100).padStart(2, '0')}`,
  order_discount_amount: '0.00', net_subtotal_amount: `${Math.floor(grand / 100)}.${String(grand % 100).padStart(2, '0')}`,
  total_tax_amount: '0.00', grand_total_amount: `${Math.floor(grand / 100)}.${String(grand % 100).padStart(2, '0')}`, total_items_count: 2,
 };
 const query: SqlQueryExecutor['query'] = async <T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) => {
  observed.push(sql);
  if (sql.startsWith('SELECT * FROM prodx_orders')) return { rows: [] as T[] };
  if (sql.includes('FROM prodx_shifts')) return { rows: [{ id: 'shift-1' }] as unknown as T[] };
  if (sql.includes('FROM prodx_products WHERE')) return { rows: [{ id: 'product-1', store_id: 'store-1', category_id: 'cat-1', sku: 'SKU-1', barcode: 'BAR-1', name: 'Product', description: null, price_amount: '10.00', cost_price_amount: '5.00', currency: 'THB', tax_rate_bps: 0, current_stock: 10, reorder_point: 1, unit_of_measure: 'each', active: true }] as unknown as T[] };
  if (sql.includes('FROM prodx_discount_policies')) return { rows: [{ require_supervisor_approval: true, max_discount_without_approval_bps: 1500 }] as unknown as T[] };
  if (sql.startsWith('UPDATE prodx_supervisor_authorizations')) return { rows: (withSupervisor ? [{ supervisorUserId: 'supervisor-1' }] : []) as unknown as T[] };
  if (sql.includes('prodx_record_security_audit_event')) return { rows: [] as T[] };
  if (sql.startsWith('INSERT INTO prodx_orders')) return { rows: [order] as unknown as T[] };
  if (sql.startsWith('UPDATE prodx_products')) return { rows: [{ current_stock: 8 }] as unknown as T[] };
  if (sql.includes('SELECT oi.*')) return { rows: [] as T[] };
  if (sql.includes('SELECT id,method')) return { rows: [] as T[] };
  return { rows: [] as T[] };
 };
 return { query, transaction: async <T>(work: (tx: SqlQueryExecutor) => Promise<T>) => work({ query }) };
};

test('discount policy permits exactly the configured 15% threshold without supervisor approval', async () => {
 const queries: string[] = [];
 const response = await createCheckoutService(checkoutDb(1500, false, queries)).checkout(discountedRequest(1500), {
  organizationId: 'org-1', storeId: 'store-1', userId: 'user-1', sessionId: 'session-1',
 });
 assert.equal(response.success, true);
 assert.ok(queries.some((sql) => sql.includes('FROM prodx_discount_policies')));
 assert.equal(queries.some((sql) => sql.startsWith('UPDATE prodx_supervisor_authorizations')), false);
});

test('discount policy rejects 15.01% without a matching supervisor token before financial writes', async () => {
 const queries: string[] = [];
 await assert.rejects(
  createCheckoutService(checkoutDb(1501, false, queries)).checkout(discountedRequest(1501), {
   organizationId: 'org-1', storeId: 'store-1', userId: 'user-1', sessionId: 'session-1',
  }),
  (error: unknown) => error instanceof CheckoutAuthorizationError && error.code === 'DISCOUNT_SUPERVISOR_APPROVAL_REQUIRED',
 );
 assert.ok(queries.some((sql) => sql.includes('FROM prodx_discount_policies')));
 assert.equal(queries.some((sql) => /^(INSERT INTO prodx_orders|UPDATE prodx_products)/.test(sql.trimStart())), false);
});

test('discount above threshold consumes a one-time supervisor grant in the checkout transaction', async () => {
 const queries: string[] = [];
 const payload = { ...discountedRequest(1501), supervisorAuthorizationToken: 'one-time-token' };
 const response = await createCheckoutService(checkoutDb(1501, true, queries)).checkout(payload, {
  organizationId: 'org-1', storeId: 'store-1', userId: 'user-1', sessionId: 'session-1',
 });
 assert.equal(response.success, true);
 assert.ok(queries.some((sql) => sql.startsWith('UPDATE prodx_supervisor_authorizations')));
 assert.ok(queries.some((sql) => sql.includes('prodx_record_security_audit_event')));
});

test('authorization fingerprint binds full checkout while preserving the existing idempotency fingerprint contract', () => {
 const payload = discountedRequest(1600);
 assert.equal(checkoutFingerprint(payload), checkoutFingerprint({ ...payload, supervisorAuthorizationToken: 'ignored-token' }));
 assert.equal(checkoutAuthorizationFingerprint(payload), checkoutAuthorizationFingerprint({ ...payload, supervisorAuthorizationToken: 'ignored-token' }));
 const altered = { ...payload, items: [{ ...payload.items[0], lineTotal: { amountInCents: 839, currency: 'THB' } }] };
 assert.notEqual(checkoutAuthorizationFingerprint(payload), checkoutAuthorizationFingerprint(altered));
});

test('invalid or replayed discount token is rejected and audited outside the rolled-back checkout transaction', async () => {
 const queries: string[] = [];
 const payload = { ...discountedRequest(1501), supervisorAuthorizationToken: 'invalid-token' };
 await assert.rejects(
  createCheckoutService(checkoutDb(1501, false, queries)).checkout(payload, {
   organizationId: 'org-1', storeId: 'store-1', userId: 'user-1', sessionId: 'session-1',
  }),
  (error: unknown) => error instanceof CheckoutAuthorizationError && error.code === 'DISCOUNT_SUPERVISOR_AUTHORIZATION_INVALID',
 );
 assert.ok(queries.some((sql) => sql.includes('SUPERVISOR_AUTHORIZATION_REJECTED')));
});

test('authorization rejection audits through the held transaction connection without opening a second pool connection', async () => {
 const observed: string[] = [];
 const inner = checkoutDb(1501, false, observed);
 let transactionActive = false;
 let nestedStandaloneQuery = false;
 let transactionCommitted = false;
 // Model the Vercel pool contract: max=1 means the active transaction owns
 // the only connection, so a standalone db.query from inside it cannot proceed.
 const db: TransactionalSqlExecutor = {
  query: async <T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) => {
   if (transactionActive) {
    nestedStandaloneQuery = true;
    throw new Error('POOL_EXHAUSTED: max=1 connection is held by checkout transaction');
   }
   return inner.query<T>(sql, parameters);
  },
  transaction: async <T>(work: (tx: SqlQueryExecutor) => Promise<T>) => {
   transactionActive = true;
   try {
    const result = await inner.transaction(work);
    transactionCommitted = true;
    return result;
   } finally {
    transactionActive = false;
   }
  },
 };
 const payload = { ...discountedRequest(1501), supervisorAuthorizationToken: 'expired-one-time-token' };
 await assert.rejects(
  createCheckoutService(db).checkout(payload, {
   organizationId: 'org-1', storeId: 'store-1', userId: 'user-1', sessionId: 'session-1',
  }),
  (error: unknown) => error instanceof CheckoutAuthorizationError && error.code === 'DISCOUNT_SUPERVISOR_AUTHORIZATION_INVALID',
 );
 assert.equal(nestedStandaloneQuery, false);
 assert.equal(transactionCommitted, true);
 assert.ok(observed.some((sql) => sql.includes('SUPERVISOR_AUTHORIZATION_REJECTED')));
});
