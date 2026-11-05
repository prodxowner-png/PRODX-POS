import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresPool, resolveConfiguredDatabaseUrl } from '../db/postgres';
import { createTransactionalPostgresExecutor } from '../db/transaction';
import type { CheckoutRequest } from '../../src/adapters/types';
import { CheckoutConflictError, createCheckoutService } from './checkout-service';

const url=resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);const pool=url?createPostgresPool({connectionString:url,max:8}):null;const db=pool?createTransactionalPostgresExecutor(pool):null;
const id={org:'00000000-0000-4000-8000-000000001001',store:'00000000-0000-4000-8000-000000001002',store2:'00000000-0000-4000-8000-000000001003',user:'00000000-0000-4000-8000-000000001004',reg:'00000000-0000-4000-8000-000000001005',shift:'00000000-0000-4000-8000-000000001006',cat:'00000000-0000-4000-8000-000000001007',product:'00000000-0000-4000-8000-000000001008',reg2:'00000000-0000-4000-8000-000000001014',shift2:'00000000-0000-4000-8000-000000001015',product2:'00000000-0000-4000-8000-000000001016',product3:'00000000-0000-4000-8000-000000001017'};
const req=(key:string,overrides:Partial<CheckoutRequest>={}):CheckoutRequest=>({idempotencyKey:key,storeId:id.store,registerId:id.reg,cashierId:id.user,items:[{lineId:'line',product:{id:id.product,storeId:id.store,sku:'PG-1',barcode:'PG-1',name:'PG Product',categoryId:id.cat,price:{amountInCents:1000,currency:'THB'},costPrice:{amountInCents:500,currency:'THB'},taxRateBps:0,currentStock:20,reorderPoint:1,unitOfMeasure:'each'},quantity:2,unitPrice:{amountInCents:1000,currency:'THB'},discountBps:0,lineSubtotal:{amountInCents:2000,currency:'THB'},lineTax:{amountInCents:0,currency:'THB'},lineTotal:{amountInCents:2000,currency:'THB'}}],totals:{grossSubtotal:{amountInCents:2000,currency:'THB'},itemDiscounts:{amountInCents:0,currency:'THB'},orderDiscount:{amountInCents:0,currency:'THB'},netSubtotal:{amountInCents:2000,currency:'THB'},totalTax:{amountInCents:0,currency:'THB'},grandTotal:{amountInCents:2000,currency:'THB'},totalItemsCount:2},payments:[{id:'00000000-0000-4000-8000-000000001009',method:'cash',amount:{amountInCents:2000,currency:'THB'},tenderedCash:{amountInCents:2000,currency:'THB'},changeGiven:{amountInCents:0,currency:'THB'},timestamp:'2026-09-14T00:00:00.000Z'}],...overrides});
async function clean() {
  if (!pool) return;
  await pool.query('ALTER TABLE prodx_audit_log DISABLE TRIGGER prodx_audit_log_immutable_guard');
  try {
    const qs: Array<{ sql: string; params: string[] }> = [];
    qs.push(
      { sql: 'DELETE FROM prodx_cash_movements WHERE shift_id IN ($1,$2)', params: [id.shift,id.shift2] },
      { sql: 'DELETE FROM prodx_audit_log WHERE store_id=$1', params: [id.store] },
      { sql: 'DELETE FROM prodx_payments WHERE store_id=$1', params: [id.store] },
      { sql: 'DELETE FROM prodx_order_items WHERE store_id=$1', params: [id.store] },
      { sql: 'DELETE FROM prodx_inventory_ledger WHERE store_id=$1', params: [id.store] },
      { sql: 'DELETE FROM prodx_orders WHERE store_id=$1', params: [id.store] },
      { sql: 'DELETE FROM prodx_shifts WHERE id IN ($1,$2)', params: [id.shift,id.shift2] },
      { sql: 'DELETE FROM prodx_products WHERE id IN ($1,$2,$3)', params: [id.product,id.product2,id.product3] },
      { sql: 'DELETE FROM prodx_categories WHERE id=$1', params: [id.cat] },
      { sql: 'DELETE FROM prodx_registers WHERE id IN ($1,$2)', params: [id.reg,id.reg2] },
      { sql: 'DELETE FROM prodx_store_memberships WHERE store_id IN ($1,$2)', params: [id.store, id.store2] },
      { sql: 'DELETE FROM prodx_users WHERE id=$1', params: [id.user] },
      { sql: 'DELETE FROM prodx_stores WHERE id IN ($1,$2)', params: [id.store, id.store2] },
      { sql: 'DELETE FROM prodx_organizations WHERE id=$1', params: [id.org] },
    );
    for (const q of qs) await pool.query(q.sql, q.params);
  } finally {
    await pool.query('ALTER TABLE prodx_audit_log ENABLE TRIGGER prodx_audit_log_immutable_guard');
  }
}

async function seed(){if(!pool)throw new Error('DATABASE_URL required');await clean();await pool.query('INSERT INTO prodx_organizations(id,code,name) VALUES($1,$2,$3)',[id.org,'pg-core','PG Core']);await pool.query('INSERT INTO prodx_stores(id,organization_id,code,name,business_timezone) VALUES($1,$2,$3,$4,$5),($6,$2,$7,$8,$5)',[id.store,id.org,'pg-1','PG Store 1','Asia/Bangkok',id.store2,'pg-2','PG Store 2']);await pool.query('INSERT INTO prodx_users(id,organization_id,username,display_name) VALUES($1,$2,$3,$4)',[id.user,id.org,'pg-user','PG User']);await pool.query('INSERT INTO prodx_store_memberships(organization_id,store_id,user_id) VALUES($1,$2,$3)',[id.org,id.store,id.user]);await pool.query('INSERT INTO prodx_registers(id,organization_id,store_id,code,name) VALUES($1,$2,$3,$4,$5),($6,$2,$3,$7,$8)',[id.reg,id.org,id.store,'R1','Register 1',id.reg2,'R2','Register 2']);await pool.query("INSERT INTO prodx_shifts(id,organization_id,store_id,register_id,cashier_id,opening_float_amount,currency) VALUES($1,$2,$3,$4,$5,0,'THB'),($6,$2,$3,$7,$5,0,'THB')",[id.shift,id.org,id.store,id.reg,id.user,id.shift2,id.reg2]);await pool.query('INSERT INTO prodx_categories(id,organization_id,store_id,name,slug) VALUES($1,$2,$3,$4,$5)',[id.cat,id.org,id.store,'Category','category']);await pool.query("INSERT INTO prodx_products(id,organization_id,store_id,category_id,sku,barcode,name,price_amount,cost_price_amount,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure) VALUES($1,$2,$3,$4,'PG-1','PG-1','PG Product 1',10.00,5.00,'THB',0,20,1,'each'),($5,$2,$3,$4,'PG-2','PG-2','PG Product 2',10.00,5.00,'THB',0,20,1,'each'),($6,$2,$3,$4,'PG-3','PG-3','PG Product 3',10.00,5.00,'THB',0,20,1,'each')",[id.product,id.org,id.store,id.cat,id.product2,id.product3]);}

test('PostgreSQL checkout proves atomicity, authoritative pricing, idempotency and store isolation',async t=>{if(!pool||!db){t.skip('DATABASE_URL not configured');return;}await seed();t.after(async()=>{await clean();await pool.end();});const service=createCheckoutService(db);const first=await service.checkout(req('success'));assert.equal(first.order.totals.grandTotal.amountInCents,2000);assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1',[id.product])).rows[0].current_stock,18);assert.match((await pool.query('SELECT idempotency_payload_hash FROM prodx_orders WHERE id=$1',[first.order.id])).rows[0].idempotency_payload_hash,/^[a-f0-9]{64}$/);const cached=await service.checkout(req('success'));assert.equal(cached.idempotencyCached,true);assert.equal(cached.order.id,first.order.id);await assert.rejects(service.checkout(req('success',{payments:[{...req('success').payments[0],tenderedCash:{amountInCents:2000,currency:'USD'}}]})),(error:unknown)=>error instanceof CheckoutConflictError);assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_orders WHERE idempotency_key=$1',['success'])).rows[0].n,1);await assert.rejects(service.checkout(req('success',{items:[{...req('success').items[0],quantity:1}]})),(error:unknown)=>error instanceof CheckoutConflictError);assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1',[id.product])).rows[0].current_stock,18);
 const bad=[{...req('rollback').payments[0],id:'00000000-0000-4000-8000-000000001010'},{...req('rollback').payments[0],id:'00000000-0000-4000-8000-000000001010'}];const before=(await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1',[id.product])).rows[0].current_stock;await assert.rejects(service.checkout(req('rollback',{payments:bad})));assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1',[id.product])).rows[0].current_stock,before);assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_orders WHERE idempotency_key=$1',['rollback'])).rows[0].n,0);
 const concurrentPayment={...req('concurrent').payments[0],id:'00000000-0000-4000-8000-000000001012'};const concurrentRequest=req('concurrent',{payments:[concurrentPayment]});const results=await Promise.all([1,2,3,4].map(()=>service.checkout(concurrentRequest)));assert.equal(new Set(results.map(r=>r.order.id)).size,1);assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_orders WHERE idempotency_key=$1',['concurrent'])).rows[0].n,1);assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_payments p JOIN prodx_orders o ON o.id=p.order_id WHERE o.idempotency_key=$1',['concurrent'])).rows[0].n,1);await assert.rejects(service.checkout(req('cross-store',{storeId:id.store2})));
 // Distinct shifts and idempotency keys must serialize product locks in the same UUID order even when clients submit opposite item orders.
 const lineA={...req('race-a').items[0],lineId:'race-a-product-1',quantity:1,lineSubtotal:{amountInCents:1000,currency:'THB'},lineTotal:{amountInCents:1000,currency:'THB'},product:{...req('race-a').items[0].product,id:id.product}};
 const lineB={...req('race-a').items[0],lineId:'race-a-product-2',quantity:1,lineSubtotal:{amountInCents:1000,currency:'THB'},lineTotal:{amountInCents:1000,currency:'THB'},product:{...req('race-a').items[0].product,id:id.product2,sku:'PG-2',barcode:'PG-2',name:'PG Product 2'}};
 const raceItems=[lineA,lineB];
 const raceTotals={grossSubtotal:{amountInCents:2000,currency:'THB'},itemDiscounts:{amountInCents:0,currency:'THB'},orderDiscount:{amountInCents:0,currency:'THB'},netSubtotal:{amountInCents:2000,currency:'THB'},totalTax:{amountInCents:0,currency:'THB'},grandTotal:{amountInCents:2000,currency:'THB'},totalItemsCount:2};
 const raceRequest=(key:string,registerId:string,paymentId:string,items:typeof raceItems)=>req(key,{registerId,items,totals:raceTotals,payments:[{...req(key).payments[0],id:paymentId,amount:{amountInCents:2000,currency:'THB'},tenderedCash:{amountInCents:2000,currency:'THB'},changeGiven:{amountInCents:0,currency:'THB'}}]});
 const stockBeforeRace=(await pool.query('SELECT id,current_stock FROM prodx_products WHERE id=ANY($1::uuid[]) ORDER BY id',[[id.product,id.product2]])).rows;
 const races=await Promise.all([raceRequest('opposite-order-a',id.reg,'00000000-0000-4000-8000-000000001018',raceItems),raceRequest('opposite-order-b',id.reg2,'00000000-0000-4000-8000-000000001019',[...raceItems].reverse())].map(r=>service.checkout(r)));
 assert.equal(new Set(races.map(r=>r.order.id)).size,2);
 const stockAfterRace=(await pool.query('SELECT id,current_stock FROM prodx_products WHERE id=ANY($1::uuid[]) ORDER BY id',[[id.product,id.product2]])).rows;
 assert.deepEqual(stockAfterRace.map((r:any)=>Number(r.current_stock)),stockBeforeRace.map((r:any)=>Number(r.current_stock)-2));
 assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_orders WHERE idempotency_key IN ($1,$2)',['opposite-order-a','opposite-order-b'])).rows[0].n,2);
 const discountedRequest=req('order-discount',{
   orderDiscountBps:1000,
   totals:{...req('order-discount').totals,orderDiscount:{amountInCents:200,currency:'THB'},netSubtotal:{amountInCents:1800,currency:'THB'},grandTotal:{amountInCents:1800,currency:'THB'}},
   payments:[{...req('order-discount').payments[0],id:'00000000-0000-4000-8000-000000001013',amount:{amountInCents:1800,currency:'THB'},tenderedCash:{amountInCents:1800,currency:'THB'},changeGiven:{amountInCents:0,currency:'THB'}}],
 });
 const discounted=await service.checkout(discountedRequest);
 assert.equal(discounted.order.totals.orderDiscount.amountInCents,200);
 assert.equal(discounted.order.totals.grandTotal.amountInCents,1800);
 // Three equal lines and a 1.00 discount create tied largest remainders; the database refund guard must use deterministic UUID tie-breaking.
 const multiLines=[id.product,id.product2,id.product3].map((productId,index)=>({...req('multi-line-discount').items[0],lineId:`multi-${index}`,product:{...req('multi-line-discount').items[0].product,id:productId,sku:`PG-${index+1}`,barcode:`PG-${index+1}`,name:`PG Product ${index+1}`},quantity:1,lineSubtotal:{amountInCents:1000,currency:'THB'},lineTotal:{amountInCents:1000,currency:'THB'}}));
 const multiTotals={grossSubtotal:{amountInCents:3000,currency:'THB'},itemDiscounts:{amountInCents:0,currency:'THB'},orderDiscount:{amountInCents:100,currency:'THB'},netSubtotal:{amountInCents:2900,currency:'THB'},totalTax:{amountInCents:0,currency:'THB'},grandTotal:{amountInCents:2900,currency:'THB'},totalItemsCount:3};
 const multi=await service.checkout(req('multi-line-discount',{items:multiLines,orderDiscountBps:333,totals:multiTotals,payments:[{...req('multi-line-discount').payments[0],id:'00000000-0000-4000-8000-000000001020',amount:{amountInCents:2900,currency:'THB'},tenderedCash:{amountInCents:2900,currency:'THB'},changeGiven:{amountInCents:0,currency:'THB'}}]}));
 assert.equal(multi.order.totals.orderDiscount.amountInCents,100);
 assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_order_items WHERE order_id=$1',[multi.order.id])).rows[0].n,3);
});
