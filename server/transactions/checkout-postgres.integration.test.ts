import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresPool, resolveConfiguredDatabaseUrl } from '../db/postgres';
import { createTransactionalPostgresExecutor } from '../db/transaction';
import type { CheckoutRequest } from '../../src/adapters/types';
import { CheckoutConflictError, createCheckoutService } from './checkout-service';

const url=resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);const pool=url?createPostgresPool({connectionString:url,max:8}):null;const db=pool?createTransactionalPostgresExecutor(pool):null;
const id={org:'00000000-0000-4000-8000-000000001001',store:'00000000-0000-4000-8000-000000001002',store2:'00000000-0000-4000-8000-000000001003',user:'00000000-0000-4000-8000-000000001004',reg:'00000000-0000-4000-8000-000000001005',shift:'00000000-0000-4000-8000-000000001006',cat:'00000000-0000-4000-8000-000000001007',product:'00000000-0000-4000-8000-000000001008'};
const req=(key:string,overrides:Partial<CheckoutRequest>={}):CheckoutRequest=>({idempotencyKey:key,storeId:id.store,registerId:id.reg,cashierId:id.user,items:[{lineId:'line',product:{id:id.product,storeId:id.store,sku:'PG-1',barcode:'PG-1',name:'PG Product',categoryId:id.cat,price:{amountInCents:1000,currency:'THB'},costPrice:{amountInCents:500,currency:'THB'},taxRateBps:0,currentStock:20,reorderPoint:1,unitOfMeasure:'each'},quantity:2,unitPrice:{amountInCents:1000,currency:'THB'},discountBps:0,lineSubtotal:{amountInCents:2000,currency:'THB'},lineTax:{amountInCents:0,currency:'THB'},lineTotal:{amountInCents:2000,currency:'THB'}}],totals:{grossSubtotal:{amountInCents:2000,currency:'THB'},itemDiscounts:{amountInCents:0,currency:'THB'},orderDiscount:{amountInCents:0,currency:'THB'},netSubtotal:{amountInCents:2000,currency:'THB'},totalTax:{amountInCents:0,currency:'THB'},grandTotal:{amountInCents:2000,currency:'THB'},totalItemsCount:2},payments:[{id:'00000000-0000-4000-8000-000000001009',method:'cash',amount:{amountInCents:2000,currency:'THB'},tenderedCash:{amountInCents:2000,currency:'THB'},changeGiven:{amountInCents:0,currency:'THB'},timestamp:'2026-09-14T00:00:00.000Z'}],...overrides});
async function clean() {
  if (!pool) return;
  await pool.query('ALTER TABLE prodx_audit_log DISABLE TRIGGER prodx_audit_log_immutable_guard');
  try {
    const qs: Array<{ sql: string; params: string[] }> = [];
    qs.push(
      { sql: 'DELETE FROM prodx_cash_movements WHERE shift_id=$1', params: [id.shift] },
      { sql: 'DELETE FROM prodx_audit_log WHERE store_id=$1', params: [id.store] },
      { sql: 'DELETE FROM prodx_payments WHERE store_id=$1', params: [id.store] },
      { sql: 'DELETE FROM prodx_order_items WHERE store_id=$1', params: [id.store] },
      { sql: 'DELETE FROM prodx_inventory_ledger WHERE store_id=$1', params: [id.store] },
      { sql: 'DELETE FROM prodx_orders WHERE store_id=$1', params: [id.store] },
      { sql: 'DELETE FROM prodx_shifts WHERE id=$1', params: [id.shift] },
      { sql: 'DELETE FROM prodx_products WHERE id=$1', params: [id.product] },
      { sql: 'DELETE FROM prodx_categories WHERE id=$1', params: [id.cat] },
      { sql: 'DELETE FROM prodx_registers WHERE id=$1', params: [id.reg] },
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

async function seed(){if(!pool)throw new Error('DATABASE_URL required');await clean();await pool.query('INSERT INTO prodx_organizations(id,code,name) VALUES($1,$2,$3)',[id.org,'pg-core','PG Core']);await pool.query('INSERT INTO prodx_stores(id,organization_id,code,name,business_timezone) VALUES($1,$2,$3,$4,$5),($6,$2,$7,$8,$5)',[id.store,id.org,'pg-1','PG Store 1','Asia/Bangkok',id.store2,'pg-2','PG Store 2']);await pool.query('INSERT INTO prodx_users(id,organization_id,username,display_name) VALUES($1,$2,$3,$4)',[id.user,id.org,'pg-user','PG User']);await pool.query('INSERT INTO prodx_store_memberships(organization_id,store_id,user_id) VALUES($1,$2,$3)',[id.org,id.store,id.user]);await pool.query('INSERT INTO prodx_registers(id,organization_id,store_id,code,name) VALUES($1,$2,$3,$4,$5)',[id.reg,id.org,id.store,'R1','Register']);await pool.query("INSERT INTO prodx_shifts(id,organization_id,store_id,register_id,cashier_id,opening_float_amount,currency) VALUES($1,$2,$3,$4,$5,0,'THB')",[id.shift,id.org,id.store,id.reg,id.user]);await pool.query('INSERT INTO prodx_categories(id,organization_id,store_id,name,slug) VALUES($1,$2,$3,$4,$5)',[id.cat,id.org,id.store,'Category','category']);await pool.query("INSERT INTO prodx_products(id,organization_id,store_id,category_id,sku,barcode,name,price_amount,cost_price_amount,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure) VALUES($1,$2,$3,$4,'PG-1','PG-1','PG Product',10.00,5.00,'THB',0,20,1,'each')",[id.product,id.org,id.store,id.cat]);}

test('PostgreSQL checkout proves atomicity, authoritative pricing, idempotency and store isolation',async t=>{if(!pool||!db){t.skip('DATABASE_URL not configured');return;}await seed();t.after(async()=>{await clean();await pool.end();});const service=createCheckoutService(db);const first=await service.checkout(req('success'));assert.equal(first.order.totals.grandTotal.amountInCents,2000);assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1',[id.product])).rows[0].current_stock,18);assert.match((await pool.query('SELECT idempotency_payload_hash FROM prodx_orders WHERE id=$1',[first.order.id])).rows[0].idempotency_payload_hash,/^[a-f0-9]{64}$/);const cached=await service.checkout(req('success'));assert.equal(cached.idempotencyCached,true);assert.equal(cached.order.id,first.order.id);assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_orders WHERE idempotency_key=$1',['success'])).rows[0].n,1);await assert.rejects(service.checkout(req('success',{items:[{...req('success').items[0],quantity:1}]})),(error:unknown)=>error instanceof CheckoutConflictError);assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1',[id.product])).rows[0].current_stock,18);
 const bad=[{...req('rollback').payments[0],id:'00000000-0000-4000-8000-000000001010'},{...req('rollback').payments[0],id:'00000000-0000-4000-8000-000000001010'}];const before=(await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1',[id.product])).rows[0].current_stock;await assert.rejects(service.checkout(req('rollback',{payments:bad})));assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id=$1',[id.product])).rows[0].current_stock,before);assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_orders WHERE idempotency_key=$1',['rollback'])).rows[0].n,0);
 const concurrentPayment={...req('concurrent').payments[0],id:'00000000-0000-4000-8000-000000001012'};const concurrentRequest=req('concurrent',{payments:[concurrentPayment]});const results=await Promise.all([1,2,3,4].map(()=>service.checkout(concurrentRequest)));assert.equal(new Set(results.map(r=>r.order.id)).size,1);assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_orders WHERE idempotency_key=$1',['concurrent'])).rows[0].n,1);assert.equal((await pool.query('SELECT count(*)::int n FROM prodx_payments p JOIN prodx_orders o ON o.id=p.order_id WHERE o.idempotency_key=$1',['concurrent'])).rows[0].n,1);await assert.rejects(service.checkout(req('cross-store',{storeId:id.store2})));});
