import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { CheckoutRequest } from '../../src/adapters/types';
import { createPostgresPool } from '../db/postgres';
import { assertDisposableTestDatabaseUrl } from '../db/test-database-guard';
import type { SqlQueryExecutor, TransactionalSqlExecutor } from '../db/transaction';
import { createTransactionalPostgresExecutor } from '../db/transaction';
import { createApp } from '../http/createApp';
import { registerPaymentWebhookRoute } from '../http/payment-webhook-route';
import { createCheckoutService } from '../transactions/checkout-service';
import { assertValidPaymentTransition, isValidPaymentTransition, PaymentTransitionError } from './provider';
import { signStripeWebhookPayload } from './stripe-webhook';

const WEBHOOK_SECRET = 'whsec_test_prodx_m2_stripe_signing_secret_0123456789';

const configuredUrl = process.env.DATABASE_URL?.trim();
const url = configuredUrl
  ? assertDisposableTestDatabaseUrl(configuredUrl, 'Stripe webhook PostgreSQL integration test')
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

/**
 * Wraps a PostgreSQL pool so every transaction executes under the real
 * least-privileged `prodx_app` runtime role (NOSUPERUSER, NOBYPASSRLS).
 */
const createProdxAppExecutor = (pool: Pool): TransactionalSqlExecutor => ({
  query: async <T extends QueryResultRow>(sql: string, parameters: readonly unknown[] = []) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE prodx_app');
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
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE prodx_app');
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

test('payment status transition validator enforces valid 8-state transitions', () => {
  assert.equal(isValidPaymentTransition('pending', 'authorized'), true);
  assert.equal(isValidPaymentTransition('pending', 'captured'), true);
  assert.equal(isValidPaymentTransition('pending', 'failed'), true);
  assert.equal(isValidPaymentTransition('pending', 'cancelled'), true);
  assert.equal(isValidPaymentTransition('authorized', 'captured'), true);
  assert.equal(isValidPaymentTransition('captured', 'settled'), true);
  assert.equal(isValidPaymentTransition('captured', 'voided'), true);

  assert.equal(isValidPaymentTransition('captured', 'failed'), false);
  assert.equal(isValidPaymentTransition('captured', 'pending'), false);
  assert.equal(isValidPaymentTransition('settled', 'failed'), false);
  assert.equal(isValidPaymentTransition('failed', 'captured'), false);
  assert.equal(isValidPaymentTransition('cancelled', 'captured'), false);
  assert.equal(isValidPaymentTransition('voided', 'captured'), false);

  assert.throws(() => assertValidPaymentTransition('captured', 'failed'), PaymentTransitionError);
});

test('POST /api/v1/webhooks/stripe fails closed with 503 when STRIPE_WEBHOOK_SECRET is missing and rejects invalid signatures before DB tx', async () => {
  let dbTouched = false;
  const untouchedDb: TransactionalSqlExecutor = {
    query: async () => { dbTouched = true; throw new Error('DB must not be touched'); },
    transaction: async () => { dbTouched = true; throw new Error('DB tx must not be opened'); },
  };

  // 1. Fail-closed 503 when secret is absent
  const savedEnvSecret = process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  try {
    const appUnconfigured = createApp({
      authenticateRequest: () => null,
      configurePublicRoutes: (configuredApp) => registerPaymentWebhookRoute(configuredApp, untouchedDb, { webhookSecret: '' }),
    });
    const unconfiguredServer = await startServer(appUnconfigured);
    try {
      const res = await fetch(`${unconfiguredServer.baseUrl}/api/v1/webhooks/stripe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'evt_unconfigured', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } }),
      });
      assert.equal(res.status, 503);
      const body = await res.json() as { error: { code: string } };
      assert.equal(body.error.code, 'PAYMENT_WEBHOOK_NOT_CONFIGURED');
      assert.equal(dbTouched, false);
    } finally {
      await unconfiguredServer.close();
    }
  } finally {
    if (savedEnvSecret !== undefined) process.env.STRIPE_WEBHOOK_SECRET = savedEnvSecret;
  }

  // 2. Signature verification failures (missing, malformed, tampered raw bytes, expired)
  const fixedNow = 1_763_900_000;
  const app = createApp({
    authenticateRequest: () => null,
    configurePublicRoutes: (configuredApp) => registerPaymentWebhookRoute(configuredApp, untouchedDb, {
      webhookSecret: WEBHOOK_SECRET,
      nowSeconds: () => fixedNow,
    }),
  });
  const server = await startServer(app);
  try {
    const rawPayload = JSON.stringify({
      id: 'evt_sig_test_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_sig_test_1' } },
    });

    // Missing header -> 400
    const missingRes = await fetch(`${server.baseUrl}/api/v1/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: rawPayload,
    });
    assert.equal(missingRes.status, 400);
    assert.equal(((await missingRes.json()) as { error: { code: string } }).error.code, 'WEBHOOK_SIGNATURE_MISSING');

    // Malformed header -> 400
    const malformedRes = await fetch(`${server.baseUrl}/api/v1/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'not-a-valid-header' },
      body: rawPayload,
    });
    assert.equal(malformedRes.status, 400);
    assert.equal(((await malformedRes.json()) as { error: { code: string } }).error.code, 'WEBHOOK_SIGNATURE_MALFORMED');

    // Tampered raw bytes (extra whitespace changes raw bytes even though parsed JSON is identical) -> 401
    const sigForCompact = signStripeWebhookPayload(rawPayload, WEBHOOK_SECRET, fixedNow);
    const tamperedRawBody = ` ${rawPayload} `;
    const tamperedRes = await fetch(`${server.baseUrl}/api/v1/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': sigForCompact },
      body: tamperedRawBody,
    });
    assert.equal(tamperedRes.status, 401);
    assert.equal(((await tamperedRes.json()) as { error: { code: string } }).error.code, 'WEBHOOK_SIGNATURE_INVALID');

    // Expired timestamp (> 300s old) -> 401
    const expiredSig = signStripeWebhookPayload(rawPayload, WEBHOOK_SECRET, fixedNow - 301);
    const expiredRes = await fetch(`${server.baseUrl}/api/v1/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': expiredSig },
      body: rawPayload,
    });
    assert.equal(expiredRes.status, 401);
    assert.equal(((await expiredRes.json()) as { error: { code: string } }).error.code, 'WEBHOOK_SIGNATURE_EXPIRED');

    assert.equal(dbTouched, false, 'invalid webhooks must never open a database transaction');
  } finally {
    await server.close();
  }
});

test('PostgreSQL Stripe webhook route verifies signatures, deduplicates concurrent replays, blocks invalid regressions, and enforces tenant RLS under prodx_app', async (t) => {
  if (!url) {
    t.skip('DATABASE_URL not configured');
    return;
  }

  const pool = createPostgresPool({ connectionString: url, max: 10 });
  const adminDb = createTransactionalPostgresExecutor(pool);
  const appDb = createProdxAppExecutor(pool);
  t.after(async () => { await pool.end(); });

  const id = {
    org: randomUUID(), store: randomUUID(),
    foreignOrg: randomUUID(), foreignStore: randomUUID(),
    user: randomUUID(), register: randomUUID(), shift: randomUUID(),
    category: randomUUID(), product: randomUUID(),
    payment1: randomUUID(), payment2: randomUUID(),
  };
  const suffix = id.org.replaceAll('-', '').slice(0, 12);

  await pool.query('INSERT INTO prodx_organizations(id,code,name) VALUES($1,$2,$3),($4,$5,$6)', [
    id.org, `wh-org-${suffix}`, 'Webhook Test Org',
    id.foreignOrg, `wh-foreign-org-${suffix}`, 'Foreign Webhook Org',
  ]);
  await pool.query(
    'INSERT INTO prodx_stores(id,organization_id,code,name,business_timezone) VALUES($1,$2,$3,$4,$5),($6,$7,$8,$9,$5)',
    [id.store, id.org, `wh-store-${suffix}`, 'Webhook Test Store', 'Asia/Bangkok',
      id.foreignStore, id.foreignOrg, `wh-foreign-store-${suffix}`, 'Foreign Webhook Store'],
  );
  await pool.query('INSERT INTO prodx_users(id,organization_id,username,display_name) VALUES($1,$2,$3,$4)', [
    id.user, id.org, `wh-user-${suffix}`, 'Webhook Cashier',
  ]);
  await pool.query('INSERT INTO prodx_store_memberships(organization_id,store_id,user_id) VALUES($1,$2,$3)', [id.org, id.store, id.user]);
  await pool.query('INSERT INTO prodx_registers(id,organization_id,store_id,code,name) VALUES($1,$2,$3,$4,$5)', [
    id.register, id.org, id.store, `WH-R-${suffix}`, 'Webhook Register',
  ]);
  await pool.query(
    "INSERT INTO prodx_shifts(id,organization_id,store_id,register_id,cashier_id,opening_float_amount,currency) VALUES($1,$2,$3,$4,$5,0,'THB')",
    [id.shift, id.org, id.store, id.register, id.user],
  );
  await pool.query('INSERT INTO prodx_categories(id,organization_id,store_id,name,slug) VALUES($1,$2,$3,$4,$5)', [
    id.category, id.org, id.store, 'Webhook Category', `wh-cat-${suffix}`,
  ]);
  await pool.query(
    "INSERT INTO prodx_products(id,organization_id,store_id,category_id,sku,barcode,name,price_amount,cost_price_amount,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure) VALUES($1,$2,$3,$4,$5,$5,'Webhook Fixture Product',15.00,5.00,'THB',0,20,1,'each')",
    [id.product, id.org, id.store, id.category, `WH-${suffix}`],
  );

  const makeCheckout = (key: string, paymentId: string): CheckoutRequest => ({
    idempotencyKey: key,
    storeId: id.store,
    registerId: id.register,
    cashierId: id.user,
    items: [{
      lineId: `line-${paymentId}`,
      product: {
        id: id.product, storeId: id.store, sku: `WH-${suffix}`, barcode: `WH-${suffix}`,
        name: 'Webhook Fixture Product', categoryId: id.category,
        price: { amountInCents: 1500, currency: 'THB' },
        costPrice: { amountInCents: 500, currency: 'THB' }, taxRateBps: 0,
        currentStock: 20, reorderPoint: 1, unitOfMeasure: 'each',
      },
      quantity: 1,
      unitPrice: { amountInCents: 1500, currency: 'THB' },
      discountBps: 0,
      lineSubtotal: { amountInCents: 1500, currency: 'THB' },
      lineTax: { amountInCents: 0, currency: 'THB' },
      lineTotal: { amountInCents: 1500, currency: 'THB' },
    }],
    totals: {
      grossSubtotal: { amountInCents: 1500, currency: 'THB' },
      itemDiscounts: { amountInCents: 0, currency: 'THB' },
      orderDiscount: { amountInCents: 0, currency: 'THB' },
      netSubtotal: { amountInCents: 1500, currency: 'THB' },
      totalTax: { amountInCents: 0, currency: 'THB' },
      grandTotal: { amountInCents: 1500, currency: 'THB' },
      totalItemsCount: 1,
    },
    payments: [{
      id: paymentId, method: 'qr_digital', amount: { amountInCents: 1500, currency: 'THB' },
      timestamp: '2026-11-23T00:00:00.000Z',
    }],
  });

  const checkoutService = createCheckoutService(adminDb);
  const order1 = await checkoutService.checkout(makeCheckout(`wh-order-1-${suffix}`, id.payment1));
  const order2 = await checkoutService.checkout(makeCheckout(`wh-order-2-${suffix}`, id.payment2));

  const piRef1 = `pi_test_wh_1_${suffix}`;
  const piRef2 = `pi_test_wh_2_${suffix}`;
  await pool.query(
    "UPDATE prodx_payments SET status='authorized', provider='stripe', provider_reference=$1, captured_at=NULL WHERE id=$2 AND store_id=$3",
    [piRef1, id.payment1, id.store],
  );
  await pool.query(
    "UPDATE prodx_payments SET status='pending', provider='stripe', provider_reference=$1, captured_at=NULL WHERE id=$2 AND store_id=$3",
    [piRef2, id.payment2, id.store],
  );

  const app = createApp({
    authenticateRequest: () => null,
    configurePublicRoutes: (configuredApp) => registerPaymentWebhookRoute(configuredApp, appDb, {
      webhookSecret: WEBHOOK_SECRET,
    }),
  });
  const server = await startServer(app);
  try {
    // 0a. Underpaid payment_intent.succeeded (amount_received < prodx_payments.amount) -> 409 PAYMENT_WEBHOOK_AMOUNT_MISMATCH, status unchanged
    const underpaidEventId = `evt_test_underpaid_${suffix}`;
    const underpaidBody = JSON.stringify({
      id: underpaidEventId,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: piRef1,
          amount: 1500,
          amount_received: 100,
          currency: 'thb',
          metadata: {
            organizationId: id.org,
            storeId: id.store,
            orderId: order1.order.id,
            paymentId: id.payment1,
          },
        },
      },
    });
    const underpaidRes = await fetch(`${server.baseUrl}/api/v1/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signStripeWebhookPayload(underpaidBody, WEBHOOK_SECRET) },
      body: underpaidBody,
    });
    assert.equal(underpaidRes.status, 409);
    assert.equal(((await underpaidRes.json()) as { error: { code: string } }).error.code, 'PAYMENT_WEBHOOK_AMOUNT_MISMATCH');
    assert.equal((await pool.query('SELECT status FROM prodx_payments WHERE id=$1', [id.payment1])).rows[0].status, 'authorized');
    assert.equal(
      (await pool.query('SELECT status FROM prodx_payment_webhook_events WHERE provider_event_id=$1', [underpaidEventId])).rows[0].status,
      'rejected',
    );

    // 0b. Currency mismatch (usd vs THB) -> 409 PAYMENT_WEBHOOK_CURRENCY_MISMATCH, status unchanged
    const currencyMismatchEventId = `evt_test_currency_${suffix}`;
    const currencyMismatchBody = JSON.stringify({
      id: currencyMismatchEventId,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: piRef1,
          amount_received: 1500,
          currency: 'usd',
          metadata: {
            organizationId: id.org,
            storeId: id.store,
            orderId: order1.order.id,
            paymentId: id.payment1,
          },
        },
      },
    });
    const currencyMismatchRes = await fetch(`${server.baseUrl}/api/v1/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signStripeWebhookPayload(currencyMismatchBody, WEBHOOK_SECRET) },
      body: currencyMismatchBody,
    });
    assert.equal(currencyMismatchRes.status, 409);
    assert.equal(((await currencyMismatchRes.json()) as { error: { code: string } }).error.code, 'PAYMENT_WEBHOOK_CURRENCY_MISMATCH');
    assert.equal((await pool.query('SELECT status FROM prodx_payments WHERE id=$1', [id.payment1])).rows[0].status, 'authorized');
    assert.equal(
      (await pool.query('SELECT status FROM prodx_payment_webhook_events WHERE provider_event_id=$1', [currencyMismatchEventId])).rows[0].status,
      'rejected',
    );

    // 0c. Missing amount_received/amount on payment_intent.succeeded -> 409 PAYMENT_WEBHOOK_AMOUNT_MISMATCH, status unchanged
    const missingAmountEventId = `evt_test_missing_amount_${suffix}`;
    const missingAmountBody = JSON.stringify({
      id: missingAmountEventId,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: piRef1,
          currency: 'thb',
          metadata: {
            organizationId: id.org,
            storeId: id.store,
            orderId: order1.order.id,
            paymentId: id.payment1,
          },
        },
      },
    });
    const missingAmountRes = await fetch(`${server.baseUrl}/api/v1/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signStripeWebhookPayload(missingAmountBody, WEBHOOK_SECRET) },
      body: missingAmountBody,
    });
    assert.equal(missingAmountRes.status, 409);
    assert.equal(((await missingAmountRes.json()) as { error: { code: string } }).error.code, 'PAYMENT_WEBHOOK_AMOUNT_MISMATCH');
    assert.equal((await pool.query('SELECT status FROM prodx_payments WHERE id=$1', [id.payment1])).rows[0].status, 'authorized');

    // 1. Concurrent duplicate signed webhook delivery with exact amount_received + currency -> exactly 1 transition & 1 audit event
    const eventId1 = `evt_test_succeeded_${suffix}`;
    const rawBody1 = JSON.stringify({
      id: eventId1,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: piRef1,
          amount_received: 1500,
          currency: 'thb',
          metadata: {
            organizationId: id.org,
            storeId: id.store,
            orderId: order1.order.id,
            paymentId: id.payment1,
          },
        },
      },
    });
    const sig1 = signStripeWebhookPayload(rawBody1, WEBHOOK_SECRET);

    const [resA, resB] = await Promise.all([
      fetch(`${server.baseUrl}/api/v1/webhooks/stripe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': sig1 },
        body: rawBody1,
      }),
      fetch(`${server.baseUrl}/api/v1/webhooks/stripe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': sig1 },
        body: rawBody1,
      }),
    ]);

    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    const bodyA = await resA.json() as { received: boolean; duplicate: boolean };
    const bodyB = await resB.json() as { received: boolean; duplicate: boolean };
    assert.equal(bodyA.received, true);
    assert.equal(bodyB.received, true);
    assert.deepEqual([bodyA.duplicate, bodyB.duplicate].sort(), [false, true], 'exactly one concurrent delivery must win and the other must report duplicate: true');

    const payment1Row = (await pool.query(
      'SELECT status, provider, provider_reference, captured_at IS NOT NULL AS has_captured_at FROM prodx_payments WHERE id=$1 AND store_id=$2',
      [id.payment1, id.store],
    )).rows[0];
    assert.deepEqual(payment1Row, { status: 'captured', provider: 'stripe', provider_reference: piRef1, has_captured_at: true });

    const attemptCount = (await pool.query(
      'SELECT count(*)::int AS count FROM prodx_payment_attempts WHERE store_id=$1 AND payment_id=$2',
      [id.store, id.payment1],
    )).rows[0].count;
    assert.equal(attemptCount, 1, 'concurrent duplicate webhook must insert exactly 1 payment attempt');

    const auditCount = (await pool.query(
      "SELECT count(*)::int AS count FROM prodx_audit_log WHERE store_id=$1 AND action='payment_webhook_transition' AND details->>'providerEventId'=$2",
      [id.store, eventId1],
    )).rows[0].count;
    assert.equal(auditCount, 1, 'concurrent duplicate webhook must insert exactly 1 audit log entry');

    // 2. Invalid regression (captured -> failed) must be rejected with 409 and preserve captured state
    const regressionEventId = `evt_test_regress_${suffix}`;
    const regressionBody = JSON.stringify({
      id: regressionEventId,
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: piRef1,
          last_payment_error: { code: 'card_declined', message: 'Late failure event' },
        },
      },
    });
    const regressionRes = await fetch(`${server.baseUrl}/api/v1/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signStripeWebhookPayload(regressionBody, WEBHOOK_SECRET) },
      body: regressionBody,
    });
    assert.equal(regressionRes.status, 409);
    assert.equal(((await regressionRes.json()) as { error: { code: string } }).error.code, 'PAYMENT_LIFECYCLE_CONFLICT');
    const payment1AfterRegression = (await pool.query('SELECT status FROM prodx_payments WHERE id=$1', [id.payment1])).rows[0];
    assert.equal(payment1AfterRegression.status, 'captured', 'captured payment must not regress to failed');

    // 3. Cross-tenant metadata mismatch must fail closed with 409 without mutating payment2
    const crossTenantEventId = `evt_test_cross_tenant_${suffix}`;
    const crossTenantBody = JSON.stringify({
      id: crossTenantEventId,
      type: 'payment_intent.canceled',
      data: {
        object: {
          id: piRef2,
          cancellation_reason: 'abandoned',
          metadata: {
            organizationId: id.foreignOrg,
            storeId: id.foreignStore,
          },
        },
      },
    });
    const crossTenantRes = await fetch(`${server.baseUrl}/api/v1/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signStripeWebhookPayload(crossTenantBody, WEBHOOK_SECRET) },
      body: crossTenantBody,
    });
    assert.equal(crossTenantRes.status, 409);
    assert.equal(((await crossTenantRes.json()) as { error: { code: string } }).error.code, 'PAYMENT_WEBHOOK_TENANT_MISMATCH');
    const payment2AfterCrossTenant = (await pool.query('SELECT status FROM prodx_payments WHERE id=$1', [id.payment2])).rows[0];
    assert.equal(payment2AfterCrossTenant.status, 'pending', 'cross-tenant webhook must not mutate payment');

    // 4. Valid payment_intent.canceled transitions pending -> cancelled
    const cancelEventId = `evt_test_cancel_${suffix}`;
    const cancelBody = JSON.stringify({
      id: cancelEventId,
      type: 'payment_intent.canceled',
      data: {
        object: {
          id: piRef2,
          cancellation_reason: 'requested_by_customer',
          metadata: { organizationId: id.org, storeId: id.store, orderId: order2.order.id, paymentId: id.payment2 },
        },
      },
    });
    const cancelRes = await fetch(`${server.baseUrl}/api/v1/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signStripeWebhookPayload(cancelBody, WEBHOOK_SECRET) },
      body: cancelBody,
    });
    assert.equal(cancelRes.status, 200);
    const payment2AfterCancel = (await pool.query('SELECT status, failure_reason FROM prodx_payments WHERE id=$1', [id.payment2])).rows[0];
    assert.deepEqual(payment2AfterCancel, { status: 'cancelled', failure_reason: 'requested_by_customer' });

    // 5. Verify FORCE RLS & cross-tenant isolation + no-DELETE on prodx_payment_webhook_events
    const rlsMeta = (await pool.query(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class
        WHERE oid = 'public.prodx_payment_webhook_events'::regclass`,
    )).rows[0];
    assert.deepEqual(rlsMeta, { relrowsecurity: true, relforcerowsecurity: true });

    const foreignVisibility = await appDb.transaction(async (tx) => {
      await tx.query("SELECT set_config('app.organization_id', $1, true), set_config('app.store_id', $2, true)", [id.foreignOrg, id.foreignStore]);
      return (await tx.query('SELECT id FROM public.prodx_payment_webhook_events WHERE provider_event_id = $1', [eventId1])).rows;
    });
    assert.equal(foreignVisibility.length, 0, 'foreign tenant must not see webhook events belonging to another tenant');

    const deletePriv = (await pool.query(
      "SELECT has_table_privilege('prodx_app', 'public.prodx_payment_webhook_events', 'DELETE') AS can_delete",
    )).rows[0];
    assert.equal(deletePriv.can_delete, false, 'prodx_app must not have DELETE privilege on prodx_payment_webhook_events');
  } finally {
    await server.close();
  }
});
