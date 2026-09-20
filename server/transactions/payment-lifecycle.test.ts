import assert from 'node:assert/strict';
import test from 'node:test';
import { createPaymentLifecycleService, PaymentLifecycleError } from './payment-lifecycle';

const executor=(payment: Record<string,unknown>, attempts: Record<string,unknown>[]=[]): any => {
  const tx={query:async(sql:string)=>{
    if(sql.includes('FROM prodx_payment_attempts')) return {rows:attempts};
    if(sql.includes('UPDATE prodx_payments')) { payment.status='captured'; return {rows:[payment]}; }
    if(sql.includes('INSERT INTO prodx_payment_attempts')) {
      const attempt={id:'attempt-1',idempotency_key:'idem-1',order_id:payment.order_id,payment_id:payment.id,status:'captured',provider:'terminal'};
      attempts.push(attempt);
      return {rows:[attempt]};
    }
    if(sql.includes('FROM prodx_payments')) return {rows:[payment]};
    return {rows:[]};
  }};
  return {transaction:async(fn:any)=>fn(tx)};
};

const transition = (db:any, overrides: Record<string,unknown> = {}) =>
  createPaymentLifecycleService(db).transition({
    storeId:'store-1',orderId:'ord-1',paymentId:'pay-1',idempotencyKey:'idem-1',to:'captured',provider:'terminal',
    ...overrides,
  });

test('payment lifecycle replays an existing idempotency attempt',async()=>{
  const existing={id:'attempt-1',status:'captured',order_id:'ord-1',payment_id:'pay-1',provider:'terminal'};
  const result=await transition(executor({id:'pay-1',order_id:'ord-1',status:'authorized'},[existing]));
  assert.deepEqual(result,existing);
});

test('payment lifecycle rejects cross-order transitions',async()=>{
  await assert.rejects(
    transition(executor({id:'pay-1',order_id:'other-order',status:'authorized'})),
    PaymentLifecycleError,
  );
});

test('payment lifecycle rejects invalid transitions',async()=>{
  await assert.rejects(
    transition(executor({id:'pay-1',order_id:'ord-1',status:'failed'}), {idempotencyKey:'idem-3'}),
    /Invalid payment transition failed -> captured/,
  );
});

test('payment lifecycle rejects reusing an idempotency key for a different command',async()=>{
  const existing={id:'attempt-1',status:'failed',order_id:'ord-1',payment_id:'pay-1',provider:'terminal'};
  await assert.rejects(
    transition(executor({id:'pay-1',order_id:'ord-1',status:'authorized'},[existing])),
    /Idempotency key was already used for a different payment lifecycle command/,
  );
});

test('payment lifecycle rechecks idempotency after acquiring the payment lock',async()=>{
  const attempts: Record<string,unknown>[] = [];
  let firstLookup = true;
  const payment={id:'pay-1',order_id:'ord-1',status:'authorized'};
  const tx={query:async(sql:string)=>{
    if(sql.includes('FROM prodx_payment_attempts')) {
      if (firstLookup) { firstLookup=false; return {rows:[]}; }
      attempts.push({id:'attempt-concurrent',order_id:'ord-1',payment_id:'pay-1',status:'captured',provider:'terminal'});
      return {rows:[attempts[0]]};
    }
    if(sql.includes('FROM prodx_payments')) return {rows:[payment]};
    throw new Error('The implementation should replay after the second idempotency lookup.');
  }};
  await assert.rejects(
    createPaymentLifecycleService({transaction:async(fn:any)=>fn(tx)}).transition({
      storeId:'store-1',orderId:'ord-1',paymentId:'pay-1',idempotencyKey:'idem-1',to:'captured',provider:'terminal',
    }),
    /should replay after the second idempotency lookup/,
  );
  assert.equal(attempts.length,1);
});
