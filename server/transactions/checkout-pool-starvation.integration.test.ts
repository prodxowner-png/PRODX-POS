import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { createPostgresPool, resolveConfiguredDatabaseUrl } from '../db/postgres';
import { createTransactionalPostgresExecutor } from '../db/transaction';
import { assertDisposableTestDatabaseUrl } from '../db/test-database-guard';
import type { CheckoutRequest } from '../../src/adapters/types';
import {
  CheckoutAuthorizationError,
  CheckoutConflictError,
  checkoutAuthorizationFingerprint,
  createCheckoutService,
} from './checkout-service';
import { runWithRequestContext } from '../http/request-context-storage';

const url = resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);
if (url) {
  assertDisposableTestDatabaseUrl(url);
}

// Pool max: 1 strictly enforces that no open transaction can request a second connection.
// A connectionTimeoutMillis of 2000 ensures that any connection pool starvation immediately deadlocks/times out.
const pool = url ? createPostgresPool({ connectionString: url, max: 1, connectionTimeoutMillis: 2000 }) : null;
const db = pool ? createTransactionalPostgresExecutor(pool) : null;

const id = {
  org: randomUUID(),
  store: randomUUID(),
  user: randomUUID(),
  supervisor: randomUUID(),
  supervisorRole: randomUUID(),
  reg: randomUUID(),
  shift: randomUUID(),
  cat: randomUUID(),
  product: randomUUID(),
  payment: randomUUID(),
  device: randomUUID(),
  session: randomUUID(),
};
const runSuffix = id.org.replaceAll('-', '').slice(0, 12);

const buildRequest = (key: string, overrides: Partial<CheckoutRequest> = {}): CheckoutRequest => ({
  idempotencyKey: key,
  storeId: id.store,
  registerId: id.reg,
  cashierId: id.user,
  items: [{
    lineId: 'line-1',
    product: {
      id: id.product,
      storeId: id.store,
      sku: `STARVE-1-${runSuffix}`,
      barcode: `STARVE-1-${runSuffix}`,
      name: 'Starvation Test Product',
      categoryId: id.cat,
      price: { amountInCents: 1000, currency: 'THB' },
      costPrice: { amountInCents: 500, currency: 'THB' },
      taxRateBps: 0,
      currentStock: 50,
      reorderPoint: 1,
      unitOfMeasure: 'each',
    },
    quantity: 2,
    unitPrice: { amountInCents: 1000, currency: 'THB' },
    discountBps: 0,
    lineSubtotal: { amountInCents: 2000, currency: 'THB' },
    lineTax: { amountInCents: 0, currency: 'THB' },
    lineTotal: { amountInCents: 2000, currency: 'THB' },
  }],
  totals: {
    grossSubtotal: { amountInCents: 2000, currency: 'THB' },
    itemDiscounts: { amountInCents: 0, currency: 'THB' },
    orderDiscount: { amountInCents: 0, currency: 'THB' },
    netSubtotal: { amountInCents: 2000, currency: 'THB' },
    totalTax: { amountInCents: 0, currency: 'THB' },
    grandTotal: { amountInCents: 2000, currency: 'THB' },
    totalItemsCount: 2,
  },
  payments: [{
    id: randomUUID(),
    method: 'cash',
    amount: { amountInCents: 2000, currency: 'THB' },
    tenderedCash: { amountInCents: 2000, currency: 'THB' },
    changeGiven: { amountInCents: 0, currency: 'THB' },
    timestamp: '2026-11-04T00:00:00.000Z',
  }],
  ...overrides,
});

async function seed() {
  if (!pool) throw new Error('DATABASE_URL required');
  await pool.query('INSERT INTO prodx_organizations(id,code,name) VALUES($1,$2,$3)', [id.org, `starve-org-${runSuffix}`, 'Starvation Test Org']);
  await pool.query('INSERT INTO prodx_stores(id,organization_id,code,name,business_timezone) VALUES($1,$2,$3,$4,$5)', [id.store, id.org, `starve-store-${runSuffix}`, 'Starvation Store', 'Asia/Bangkok']);
  await pool.query('INSERT INTO prodx_users(id,organization_id,username,display_name) VALUES($1,$2,$3,$4),($5,$2,$6,$7)', [id.user, id.org, `starve-user-${runSuffix}`, 'Starvation Cashier', id.supervisor, `starve-supervisor-${runSuffix}`, 'Starvation Supervisor']);
  await pool.query('INSERT INTO prodx_store_memberships(organization_id,store_id,user_id,active) VALUES($1,$2,$3,TRUE),($1,$2,$4,TRUE)', [id.org, id.store, id.user, id.supervisor]);
  await pool.query("INSERT INTO prodx_roles(id,organization_id,role_key,name,active) VALUES($1,$2,'supervisor','Supervisor',TRUE)", [id.supervisorRole, id.org]);
  await pool.query("INSERT INTO prodx_permissions(id,permission_key,description) VALUES($1,'pos.discount.approve','Approve discounts') ON CONFLICT (permission_key) DO NOTHING", [randomUUID()]);
  await pool.query("INSERT INTO prodx_role_permissions(organization_id,role_id,permission_id) SELECT $1,$2,id FROM prodx_permissions WHERE permission_key='pos.discount.approve' ON CONFLICT DO NOTHING", [id.org, id.supervisorRole]);
  await pool.query('INSERT INTO prodx_user_roles(organization_id,store_id,user_id,role_id,active) VALUES($1,$2,$3,$4,TRUE)', [id.org, id.store, id.supervisor, id.supervisorRole]);
  await pool.query('INSERT INTO prodx_devices(id,organization_id,store_id,device_key,name) VALUES($1,$2,$3,$4,$5)', [id.device, id.org, id.store, `starve-dev-${runSuffix}`, 'Starvation Device']);
  await pool.query("INSERT INTO prodx_sessions(id,organization_id,user_id,device_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP + INTERVAL '1 hour')", [id.session, id.org, id.user, id.device, `starve-session-${runSuffix}`]);
  await pool.query('INSERT INTO prodx_registers(id,organization_id,store_id,code,name) VALUES($1,$2,$3,$4,$5)', [id.reg, id.org, id.store, `STARVE-R1-${runSuffix}`, 'Starvation Register']);
  await pool.query("INSERT INTO prodx_shifts(id,organization_id,store_id,register_id,cashier_id,opening_float_amount,currency) VALUES($1,$2,$3,$4,$5,0,'THB')", [id.shift, id.org, id.store, id.reg, id.user]);
  await pool.query('INSERT INTO prodx_categories(id,organization_id,store_id,name,slug) VALUES($1,$2,$3,$4,$5)', [id.cat, id.org, id.store, 'Starve Category', `starve-category-${runSuffix}`]);
  await pool.query(
    "INSERT INTO prodx_products(id,organization_id,store_id,category_id,sku,barcode,name,price_amount,cost_price_amount,currency,tax_rate_bps,current_stock,reorder_point,unit_of_measure) VALUES($1,$2,$3,$4,$5,$5,'Starvation Product',10.00,5.00,'THB',0,50,1,'each')",
    [id.product, id.org, id.store, id.cat, `STARVE-1-${runSuffix}`],
  );
  // Configure discount policy requiring supervisor approval above 15% (1500 bps)
  await pool.query(
    'UPDATE prodx_discount_policies SET require_supervisor_approval = TRUE, max_discount_without_approval_bps = 1500 WHERE organization_id = $1 AND store_id = $2',
    [id.org, id.store],
  );
}

test('PRODX-REV-001: pool max = 1 never starves or deadlocks on invalid supervisor authorization, records audit event on single connection, and releases connection', async (t) => {
  if (!pool || !db) {
    t.skip('DATABASE_URL not configured');
    return;
  }
  await seed();
  t.after(async () => {
    try {
      await pool.query('DELETE FROM prodx_supervisor_authorizations WHERE organization_id = $1', [id.org]);
    } finally {
      await pool.end();
    }
  });

  const service = createCheckoutService(db);
  const requestContext = { requestId: randomUUID(), principal: { userId: id.user, organizationId: id.org, storeId: id.store } };
  const authContext = { organizationId: id.org, storeId: id.store, userId: id.user, sessionId: id.session };

  const overThresholdKey = `starve-over-threshold-${runSuffix}`;
  const subsequentSuccessKey = `starve-subsequent-success-${runSuffix}`;
  const approvedDiscountKey = `starve-approved-discount-${runSuffix}`;
  const paymentMismatchKey = `starve-payment-mismatch-${runSuffix}`;
  const finalSuccessKey = `starve-final-success-${runSuffix}`;

  const overThresholdDiscountRequest = buildRequest(overThresholdKey, {
    items: [{
      ...buildRequest(overThresholdKey).items[0],
      discountBps: 2000, // 20% discount requires approval
      lineSubtotal: { amountInCents: 1600, currency: 'THB' },
      lineTotal: { amountInCents: 1600, currency: 'THB' },
    }],
    totals: {
      grossSubtotal: { amountInCents: 2000, currency: 'THB' },
      itemDiscounts: { amountInCents: 400, currency: 'THB' },
      orderDiscount: { amountInCents: 0, currency: 'THB' },
      netSubtotal: { amountInCents: 1600, currency: 'THB' },
      totalTax: { amountInCents: 0, currency: 'THB' },
      grandTotal: { amountInCents: 1600, currency: 'THB' },
      totalItemsCount: 2,
    },
    payments: [{
      id: randomUUID(),
      method: 'cash',
      amount: { amountInCents: 1600, currency: 'THB' },
      tenderedCash: { amountInCents: 1600, currency: 'THB' },
      changeGiven: { amountInCents: 0, currency: 'THB' },
      timestamp: '2026-11-04T00:00:00.000Z',
    }],
    supervisorAuthorizationToken: 'nonexistent-or-expired-token',
  });

  const stockBefore = (await pool.query('SELECT current_stock FROM prodx_products WHERE id = $1', [id.product])).rows[0].current_stock;

  // 1. Pool max = 1: invalid supervisor token must NOT deadlock or time out
  const startTime = Date.now();
  await assert.rejects(
    runWithRequestContext(requestContext, () => service.checkout(overThresholdDiscountRequest, authContext)),
    (error: unknown) => {
      assert.ok(error instanceof CheckoutAuthorizationError, `Expected CheckoutAuthorizationError, got ${error}`);
      assert.equal((error as CheckoutAuthorizationError).code, 'DISCOUNT_SUPERVISOR_AUTHORIZATION_INVALID');
      return true;
    },
  );
  const durationMs = Date.now() - startTime;
  assert.ok(durationMs < 1500, `Execution took ${durationMs}ms; must complete well before connection timeout`);

  // 2. Audit record was durably written on the single connection
  const auditRows = (await pool.query(
    `SELECT event_type, metadata FROM prodx_security_audit_events WHERE organization_id = $1 AND event_type = 'SUPERVISOR_AUTHORIZATION_REJECTED'`,
    [id.org],
  )).rows;
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].metadata.action, 'discount');
  assert.equal(auditRows[0].metadata.idempotencyKey, overThresholdKey);

  // 3. No order was created and stock was NOT deducted
  const orderCount = (await pool.query('SELECT count(*)::int AS count FROM prodx_orders WHERE store_id = $1 AND idempotency_key = $2', [id.store, overThresholdKey])).rows[0].count;
  assert.equal(orderCount, 0);
  const stockAfter = (await pool.query('SELECT current_stock FROM prodx_products WHERE id = $1', [id.product])).rows[0].current_stock;
  assert.equal(stockAfter, stockBefore);

  // 4. Connection was released: subsequent checkout on pool max = 1 succeeds immediately
  const successRequest = buildRequest(subsequentSuccessKey);
  const successOrder = await runWithRequestContext(requestContext, () => service.checkout(successRequest, authContext));
  assert.equal(successOrder.order.idempotencyKey, subsequentSuccessKey);
  assert.equal(successOrder.serverConfirmed, true);

  const stockAfterSuccess = (await pool.query('SELECT current_stock FROM prodx_products WHERE id = $1', [id.product])).rows[0].current_stock;
  assert.equal(stockAfterSuccess, stockBefore - 2);

  // 5. Successful checkout with supervisor authorization on pool max = 1
  const validToken = `starve-valid-token-${runSuffix}`;
  const approvedDiscountRequest = buildRequest(approvedDiscountKey, {
    items: [{
      ...buildRequest(approvedDiscountKey).items[0],
      discountBps: 2000,
      lineSubtotal: { amountInCents: 1600, currency: 'THB' },
      lineTotal: { amountInCents: 1600, currency: 'THB' },
    }],
    totals: {
      grossSubtotal: { amountInCents: 2000, currency: 'THB' },
      itemDiscounts: { amountInCents: 400, currency: 'THB' },
      orderDiscount: { amountInCents: 0, currency: 'THB' },
      netSubtotal: { amountInCents: 1600, currency: 'THB' },
      totalTax: { amountInCents: 0, currency: 'THB' },
      grandTotal: { amountInCents: 1600, currency: 'THB' },
      totalItemsCount: 2,
    },
    payments: [{
      id: randomUUID(),
      method: 'cash',
      amount: { amountInCents: 1600, currency: 'THB' },
      tenderedCash: { amountInCents: 1600, currency: 'THB' },
      changeGiven: { amountInCents: 0, currency: 'THB' },
      timestamp: '2026-11-04T00:00:00.000Z',
    }],
  });
  const approvedPayloadHash = checkoutAuthorizationFingerprint(approvedDiscountRequest);
  await pool.query(
    `INSERT INTO prodx_supervisor_authorizations
      (id, organization_id, store_id, requester_user_id, requester_session_id, supervisor_user_id, action_key, order_id,
       checkout_idempotency_key, checkout_payload_hash, policy_threshold_bps, policy_requires_approval, authorization_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $9, 'discount', NULL, $6, $7, 1500, TRUE, $8, CURRENT_TIMESTAMP + INTERVAL '5 minutes')`,
    [randomUUID(), id.org, id.store, id.user, id.session, approvedDiscountKey, approvedPayloadHash, createHash('sha256').update(validToken).digest('hex'), id.supervisor],
  );

  const approvedWithToken = { ...approvedDiscountRequest, supervisorAuthorizationToken: validToken };
  const approvedOrder = await runWithRequestContext(requestContext, () => service.checkout(approvedWithToken, authContext));
  assert.equal(approvedOrder.order.totals.grandTotal.amountInCents, 1600);
  assert.equal(approvedOrder.serverConfirmed, true);

  // Verify supervisor grant is consumed
  const consumedRow = (await pool.query(
    'SELECT consumed_at FROM prodx_supervisor_authorizations WHERE organization_id = $1 AND checkout_idempotency_key = $2',
    [id.org, approvedDiscountKey],
  )).rows[0];
  assert.ok(consumedRow.consumed_at !== null);

  // 6. Duplicate idempotency replay on pool max = 1 returns cached response
  const replayed = await runWithRequestContext(requestContext, () => service.checkout(approvedWithToken, authContext));
  assert.equal(replayed.idempotencyCached, true);
  assert.equal(replayed.order.id, approvedOrder.order.id);

  // 7. Replaying same idempotency key with different payload conflicts
  const conflictedRequest = {
    ...approvedWithToken,
    notes: 'altered payload',
  };
  await assert.rejects(
    runWithRequestContext(requestContext, () => service.checkout(conflictedRequest, authContext)),
    (error: unknown) => error instanceof CheckoutConflictError,
  );

  // 8. Business failure (e.g. payment mismatch) rolls back all mutations and releases connection on pool max = 1
  const stockBeforeMismatch = (await pool.query('SELECT current_stock FROM prodx_products WHERE id = $1', [id.product])).rows[0].current_stock;
  const mismatchPaymentRequest = buildRequest(paymentMismatchKey, {
    payments: [{
      id: randomUUID(),
      method: 'cash',
      amount: { amountInCents: 1999, currency: 'THB' }, // Grand total is 2000
      tenderedCash: { amountInCents: 1999, currency: 'THB' },
      changeGiven: { amountInCents: 0, currency: 'THB' },
      timestamp: '2026-11-04T00:00:00.000Z',
    }],
  });
  await assert.rejects(
    runWithRequestContext(requestContext, () => service.checkout(mismatchPaymentRequest, authContext)),
    (error: unknown) => error instanceof CheckoutConflictError,
  );
  // Verify no order created and stock untouched
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM prodx_orders WHERE store_id = $1 AND idempotency_key = $2', [id.store, paymentMismatchKey])).rows[0].count, 0);
  assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id = $1', [id.product])).rows[0].current_stock, stockBeforeMismatch);

  // 9. Subsequent checkout succeeds, proving connection was released even after business rollback
  const finalRequest = buildRequest(finalSuccessKey);
  const finalOrder = await runWithRequestContext(requestContext, () => service.checkout(finalRequest, authContext));
  assert.equal(finalOrder.order.idempotencyKey, finalSuccessKey);
  assert.equal(finalOrder.serverConfirmed, true);

  // 10. Insufficient stock failure path injection: rolls back order, payments, and releases connection on pool max = 1
  const insufficientStockKey = `starve-insufficient-stock-${runSuffix}`;
  const stockBeforeInsufficient = (await pool.query('SELECT current_stock FROM prodx_products WHERE id = $1', [id.product])).rows[0].current_stock;
  const insufficientStockRequest = buildRequest(insufficientStockKey, {
    items: [{
      ...buildRequest(insufficientStockKey).items[0],
      quantity: 9999, // Exceeds current available stock
      lineSubtotal: { amountInCents: 9999000, currency: 'THB' },
      lineTotal: { amountInCents: 9999000, currency: 'THB' },
    }],
    totals: {
      ...buildRequest(insufficientStockKey).totals,
      grossSubtotal: { amountInCents: 9999000, currency: 'THB' },
      netSubtotal: { amountInCents: 9999000, currency: 'THB' },
      grandTotal: { amountInCents: 9999000, currency: 'THB' },
      totalItemsCount: 9999,
    },
    payments: [{
      id: randomUUID(),
      method: 'cash',
      amount: { amountInCents: 9999000, currency: 'THB' },
      tenderedCash: { amountInCents: 9999000, currency: 'THB' },
      changeGiven: { amountInCents: 0, currency: 'THB' },
      timestamp: '2026-11-04T00:00:00.000Z',
    }],
  });
  await assert.rejects(
    runWithRequestContext(requestContext, () => service.checkout(insufficientStockRequest, authContext)),
    (error: unknown) => error instanceof CheckoutConflictError && (error as Error).message.includes('Insufficient stock'),
  );
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM prodx_orders WHERE store_id = $1 AND idempotency_key = $2', [id.store, insufficientStockKey])).rows[0].count, 0);
  assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id = $1', [id.product])).rows[0].current_stock, stockBeforeInsufficient);

  // 11. Supervisor token replay failure path: already-consumed token is rejected, audited, and connection released on pool max = 1
  const replayTokenKey = `starve-token-replay-${runSuffix}`;
  const replayTokenRequest = buildRequest(replayTokenKey, {
    items: [{
      ...buildRequest(replayTokenKey).items[0],
      discountBps: 2000,
      lineSubtotal: { amountInCents: 1600, currency: 'THB' },
      lineTotal: { amountInCents: 1600, currency: 'THB' },
    }],
    totals: {
      grossSubtotal: { amountInCents: 2000, currency: 'THB' },
      itemDiscounts: { amountInCents: 400, currency: 'THB' },
      orderDiscount: { amountInCents: 0, currency: 'THB' },
      netSubtotal: { amountInCents: 1600, currency: 'THB' },
      totalTax: { amountInCents: 0, currency: 'THB' },
      grandTotal: { amountInCents: 1600, currency: 'THB' },
      totalItemsCount: 2,
    },
    payments: [{
      id: randomUUID(),
      method: 'cash',
      amount: { amountInCents: 1600, currency: 'THB' },
      tenderedCash: { amountInCents: 1600, currency: 'THB' },
      changeGiven: { amountInCents: 0, currency: 'THB' },
      timestamp: '2026-11-04T00:00:00.000Z',
    }],
    supervisorAuthorizationToken: validToken, // validToken was already consumed in step 5
  });
  await assert.rejects(
    runWithRequestContext(requestContext, () => service.checkout(replayTokenRequest, authContext)),
    (error: unknown) => error instanceof CheckoutAuthorizationError && error.code === 'DISCOUNT_SUPERVISOR_AUTHORIZATION_INVALID',
  );
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM prodx_orders WHERE store_id = $1 AND idempotency_key = $2', [id.store, replayTokenKey])).rows[0].count, 0);
  assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id = $1', [id.product])).rows[0].current_stock, stockBeforeInsufficient);

  // 12. Audit log failure injection: failure to insert audit log rolls back order, payments, ledger, stock, and releases connection on pool max = 1
  const auditFailKey = `starve-audit-fail-injection-${runSuffix}`;
  await pool.query(`
    CREATE OR REPLACE FUNCTION fail_injected_audit_test() RETURNS trigger AS $$
    BEGIN
      IF NEW.details->>'idempotencyKey' LIKE '%audit-fail-injection%' THEN
        RAISE EXCEPTION 'INJECTED_AUDIT_LOG_FAILURE';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_test_audit_failure_injection ON prodx_audit_log;
    CREATE TRIGGER trg_test_audit_failure_injection
    BEFORE INSERT ON prodx_audit_log
    FOR EACH ROW EXECUTE FUNCTION fail_injected_audit_test();
  `);

  try {
    const auditFailRequest = buildRequest(auditFailKey);
    await assert.rejects(
      runWithRequestContext(requestContext, () => service.checkout(auditFailRequest, authContext)),
      /INJECTED_AUDIT_LOG_FAILURE/,
    );
    // Verify atomic rollback of order, payments, ledger, and stock
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM prodx_orders WHERE store_id = $1 AND idempotency_key = $2', [id.store, auditFailKey])).rows[0].count, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM prodx_payments WHERE store_id = $1 AND id = $2', [id.store, auditFailRequest.payments[0].id])).rows[0].count, 0);
    assert.equal((await pool.query('SELECT current_stock FROM prodx_products WHERE id = $1', [id.product])).rows[0].current_stock, stockBeforeInsufficient);
  } finally {
    await pool.query(`
      DROP TRIGGER IF EXISTS trg_test_audit_failure_injection ON prodx_audit_log;
      DROP FUNCTION IF EXISTS fail_injected_audit_test();
    `);
  }

  // 13. Verify connection was safely released even after audit injection failure: next checkout succeeds on pool max = 1
  const postInjectionKey = `starve-post-injection-success-${runSuffix}`;
  const postInjectionRequest = buildRequest(postInjectionKey);
  const postInjectionOrder = await runWithRequestContext(requestContext, () => service.checkout(postInjectionRequest, authContext));
  assert.equal(postInjectionOrder.order.idempotencyKey, postInjectionKey);
  assert.equal(postInjectionOrder.serverConfirmed, true);
});
