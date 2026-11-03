import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { hashPassword } from './auth/password';
import { resolveConfiguredDatabaseUrl } from './db/postgres';
import { createProductionApp } from './entrypoint';

const databaseUrl = resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);

const ids = {
  org: '00000000-0000-4000-8000-000000009401',
  store: '00000000-0000-4000-8000-000000009402',
  register: '00000000-0000-4000-8000-000000009403',
  device: '00000000-0000-4000-8000-000000009404',
  adminUser: '00000000-0000-4000-8000-000000009405',
  cashierUser: '00000000-0000-4000-8000-000000009406',
  adminRole: '00000000-0000-4000-8000-000000009407',
  cashierRole: '00000000-0000-4000-8000-000000009408',
  category: '00000000-0000-4000-8000-000000009409',
};

const requiredPermissions = [
  'pos.sell',
  'pos.discount',
  'pos.price_override',
  'pos.void',
  'pos.refund',
  'inventory.read',
  'inventory.adjust',
  'catalog.write',
  'cash.shift.open',
  'cash.shift.close',
  'cash.shift.movement',
  'audit.read',
  'settings.manage',
  'rbac.manage',
  'users.manage',
];

test('Phase 4 End-to-End Verification & Audit Trail: Auth RBAC Separation, Shift, Catalog, Inventory, Checkout, Supervisor Refund/Void, and Immutable Audit Log', async (t) => {
  if (!databaseUrl) {
    t.skip('DATABASE_URL is not configured; run with PostgreSQL.');
    return;
  }

  const { app, pool } = await createProductionApp({
    checkCompromisedPassword: async () => ({ compromised: false, count: 0 }),
  });
  const passwordHash = await hashPassword('Phase4-Pass!99');

  const cleanup = async () => {
    await pool.query('ALTER TABLE prodx_audit_log DISABLE TRIGGER prodx_audit_log_immutable_guard');
    await pool.query('ALTER TABLE prodx_refunds DISABLE TRIGGER prodx_refund_immutable_guard');
    await pool.query('ALTER TABLE prodx_refund_items DISABLE TRIGGER prodx_refund_item_immutable_guard');
    await pool.query('ALTER TABLE prodx_voids DISABLE TRIGGER prodx_void_immutable_guard');
    try {
      await pool.query('DELETE FROM prodx_supervisor_authorizations WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_cash_movements WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_inventory_ledger WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_refund_items WHERE store_id = $1', [ids.store]);
      await pool.query('DELETE FROM prodx_refunds WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_voids WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_payment_attempts WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_payments WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_order_items WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_orders WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_inventory_adjustments WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_catalog_import_operations WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_catalog_pricing_operations WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_products WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_categories WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_shift_operations WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_shifts WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_security_audit_events WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_audit_log WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_sessions WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_user_roles WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_role_permissions WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_roles WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_user_credentials WHERE user_id IN ($1, $2)', [ids.adminUser, ids.cashierUser]);
      await pool.query('DELETE FROM prodx_store_memberships WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_devices WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_registers WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_users WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_stores WHERE organization_id = $1', [ids.org]);
      await pool.query('DELETE FROM prodx_organizations WHERE id = $1', [ids.org]);
    } finally {
      await pool.query('ALTER TABLE prodx_voids ENABLE TRIGGER prodx_void_immutable_guard');
      await pool.query('ALTER TABLE prodx_refund_items ENABLE TRIGGER prodx_refund_item_immutable_guard');
      await pool.query('ALTER TABLE prodx_refunds ENABLE TRIGGER prodx_refund_immutable_guard');
      await pool.query('ALTER TABLE prodx_audit_log ENABLE TRIGGER prodx_audit_log_immutable_guard');
    }
  };

  await cleanup();
  t.after(async () => {
    await cleanup();
    await pool.end();
  });

  // Seed organization, store, register, device, users, roles, and permissions
  await pool.query('INSERT INTO prodx_organizations (id, code, name) VALUES ($1, $2, $3)', [
    ids.org,
    'phase4-org',
    'Phase 4 Verification Org',
  ]);
  await pool.query(
    `INSERT INTO prodx_stores (id, organization_id, code, name, business_timezone)
     VALUES ($1, $2, 'store-p4', 'Phase 4 Store', 'Asia/Bangkok')`,
    [ids.store, ids.org],
  );
  await pool.query(
    `INSERT INTO prodx_registers (id, organization_id, store_id, code, name, status)
     VALUES ($1, $2, $3, 'REG-P4', 'Phase 4 Register', 'active')`,
    [ids.register, ids.org, ids.store],
  );
  await pool.query(
    `INSERT INTO prodx_devices (id, organization_id, store_id, device_key, name, status)
     VALUES ($1, $2, $3, 'REG-P4', 'Phase 4 Device', 'active')`,
    [ids.device, ids.org, ids.store],
  );
  await pool.query(
    `INSERT INTO prodx_users (id, organization_id, username, display_name, status)
     VALUES ($1, $3, 'p4-admin', 'Phase 4 Admin', 'active'),
            ($2, $3, 'p4-cashier', 'Phase 4 Cashier', 'active')`,
    [ids.adminUser, ids.cashierUser, ids.org],
  );
  await pool.query(
    `INSERT INTO prodx_user_credentials (user_id, credential_type, secret_hash)
     VALUES ($1, 'password', $3), ($2, 'password', $3)`,
    [ids.adminUser, ids.cashierUser, passwordHash],
  );
  await pool.query(
    `INSERT INTO prodx_store_memberships (organization_id, store_id, user_id, active)
     VALUES ($1, $2, $3, TRUE), ($1, $2, $4, TRUE)`,
    [ids.org, ids.store, ids.adminUser, ids.cashierUser],
  );
  await pool.query(
    `INSERT INTO prodx_roles (id, organization_id, role_key, name, active)
     VALUES ($1, $3, 'admin', 'Administrator', TRUE),
            ($2, $3, 'cashier', 'Cashier', TRUE)`,
    [ids.adminRole, ids.cashierRole, ids.org],
  );

  for (const permKey of requiredPermissions) {
    await pool.query(
      `INSERT INTO prodx_permissions (id, permission_key, description)
       VALUES ($1, $2, $2)
       ON CONFLICT (permission_key) DO NOTHING`,
      [crypto.randomUUID(), permKey],
    );
    const permRow = await pool.query<{ id: string }>(
      'SELECT id FROM prodx_permissions WHERE permission_key = $1 LIMIT 1',
      [permKey],
    );
    await pool.query(
      `INSERT INTO prodx_role_permissions (organization_id, role_id, permission_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [ids.org, ids.adminRole, permRow.rows[0].id],
    );
    if (permKey.startsWith('pos.') || permKey.startsWith('cash.shift.') || permKey === 'inventory.read') {
      await pool.query(
        `INSERT INTO prodx_role_permissions (organization_id, role_id, permission_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [ids.org, ids.cashierRole, permRow.rows[0].id],
      );
    }
  }

  await pool.query(
    `INSERT INTO prodx_user_roles (organization_id, store_id, user_id, role_id, active)
     VALUES ($1, $2, $3, $4, TRUE),
            ($1, $2, $5, $6, TRUE)`,
    [ids.org, ids.store, ids.adminUser, ids.adminRole, ids.cashierUser, ids.cashierRole],
  );

  await pool.query(
    `INSERT INTO prodx_categories (id, organization_id, store_id, name, slug)
     VALUES ($1, $2, $3, 'Beverages', 'beverages')`,
    [ids.category, ids.org, ids.store],
  );

  const server = app.listen(0);
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  // 1. Phase 2 Gate: Cashier cannot authenticate at /auth/admin/login (403 ADMIN_ROLE_REQUIRED)
  const cashierAdminLogin = await fetch(`${baseUrl}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'req-p4-admin-deny' },
    body: JSON.stringify({
      organizationSlug: 'phase4-org',
      storeCode: 'store-p4',
      emailOrPin: 'p4-cashier',
      passwordOrPin: 'Phase4-Pass!99',
      registerId: 'REG-P4',
    }),
  });
  assert.equal(cashierAdminLogin.status, 403);
  assert.equal(cashierAdminLogin.headers.get('x-request-id'), 'req-p4-admin-deny');
  const denyBody = (await cashierAdminLogin.json()) as { error: { code: string } };
  assert.equal(denyBody.error.code, 'ADMIN_ROLE_REQUIRED');

  // 2. Admin authenticates at /auth/admin/login (200)
  const adminLogin = await fetch(`${baseUrl}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'req-p4-admin-ok' },
    body: JSON.stringify({
      organizationSlug: 'phase4-org',
      storeCode: 'store-p4',
      emailOrPin: 'p4-admin',
      passwordOrPin: 'Phase4-Pass!99',
      registerId: 'REG-P4',
    }),
  });
  assert.equal(adminLogin.status, 200);
  const adminSession = (await adminLogin.json()) as { token: string; currentUser: { role: string } };
  assert.equal(adminSession.currentUser.role, 'admin');
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminSession.token}`,
  };

  // 3. Phase 3 Gate: Bulk Catalog Import with exact BigInt decimal money + idempotency
  const importRes1 = await fetch(`${baseUrl}/api/v1/catalog/import`, {
    method: 'POST',
    headers: { ...authHeaders, 'x-request-id': 'req-p4-import-1' },
    body: JSON.stringify({
      idempotencyKey: 'idem-p4-import-1',
      mode: 'upsert',
      items: [
        {
          sku: 'P4-COFFEE-01',
          barcode: '8859999000011',
          name: 'Phase 4 Signature Roast',
          categoryId: ids.category,
          priceAmountInCents: 1999, // ฿19.99 (classic IEEE-754 trap: 19.99 * 100)
          costPriceAmountInCents: 850,
          taxRateBps: 700,
          currentStock: 20,
          reorderPoint: 5,
          unitOfMeasure: 'cup',
        },
      ],
    }),
  });
  assert.equal(importRes1.status, 200);
  const importBody1 = (await importRes1.json()) as {
    totalProcessed: number;
    createdCount: number;
    createdProducts: Array<{ id: string; price: { amountInCents: number } }>;
  };
  assert.equal(importBody1.createdCount, 1);
  assert.equal(importBody1.createdProducts[0].price.amountInCents, 1999);
  const productId = importBody1.createdProducts[0].id;

  // Idempotent replay of catalog import
  const importRes2 = await fetch(`${baseUrl}/api/v1/catalog/import`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      idempotencyKey: 'idem-p4-import-1',
      mode: 'upsert',
      items: [
        {
          sku: 'P4-COFFEE-01',
          barcode: '8859999000011',
          name: 'Phase 4 Signature Roast',
          categoryId: ids.category,
          priceAmountInCents: 1999,
          costPriceAmountInCents: 850,
          taxRateBps: 700,
          currentStock: 20,
          reorderPoint: 5,
          unitOfMeasure: 'cup',
        },
      ],
    }),
  });
  assert.equal(importRes2.status, 200);
  const importBody2 = (await importRes2.json()) as { createdCount: number };
  assert.equal(importBody2.createdCount, 1);

  // 4. Catalog Pricing Adjustment (+10% markup on 19.99 -> 21.99 = 2199 cents)
  const pricingRes = await fetch(`${baseUrl}/api/v1/catalog/pricing/bulk`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      idempotencyKey: 'idem-p4-pricing-1',
      productIds: [productId],
      priceChangeType: 'percent_markup',
      value: 10,
    }),
  });
  assert.equal(pricingRes.status, 201);
  const pricingBody = (await pricingRes.json()) as {
    idempotencyCached: boolean;
    products: Array<{ id: string; price: { amountInCents: number } }>;
  };
  assert.equal(pricingBody.products[0].price.amountInCents, 2199);

  // 5. Inventory Stock Adjustment (+5 purchase_received: 20 -> 25 stock)
  const invRes = await fetch(`${baseUrl}/api/v1/inventory/adjustments`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      idempotencyKey: 'idem-p4-inv-1',
      productIds: [productId],
      quantityDelta: 5,
      reason: 'purchase_received',
      notes: 'Phase 4 restock verification',
    }),
  });
  assert.equal(invRes.status, 201);
  const invBody = (await invRes.json()) as {
    entries: Array<{ resulting_stock: number }>;
  };
  assert.equal(invBody.entries[0].resulting_stock, 25);

  // 6. Shift Open (starting cash ฿1,000.00 = 100000 cents)
  const shiftOpenRes = await fetch(`${baseUrl}/api/v1/shifts/open`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      idempotencyKey: 'idem-p4-shift-open',
      registerId: ids.register,
      openingFloat: { amountInCents: 100000, currency: 'THB' },
    }),
  });
  assert.equal(shiftOpenRes.status, 201);
  const shiftOpenBody = (await shiftOpenRes.json()) as { id: string; openingFloat: { amountInCents: number } };
  assert.equal(shiftOpenBody.openingFloat.amountInCents, 100000);
  const shiftId = shiftOpenBody.id;

  // 7. Checkout Order #1 (2 units @ 2199 cents = 4398 cents)
  // Tax inclusive 7%: (4398 * 700 + 5350) / 10700 = 288 cents tax, 4110 cents netSubtotal
  const checkout1Res = await fetch(`${baseUrl}/api/v1/orders/checkout`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      idempotencyKey: 'idem-p4-checkout-1',
      storeId: ids.store,
      registerId: ids.register,
      cashierId: ids.adminUser,
      items: [
        {
          lineId: 'line-1',
          product: {
            id: productId,
            storeId: ids.store,
            sku: 'P4-COFFEE-01',
            barcode: '8859999000011',
            name: 'Phase 4 Signature Roast',
            categoryId: ids.category,
            price: { amountInCents: 2199, currency: 'THB' },
            costPrice: { amountInCents: 850, currency: 'THB' },
            taxRateBps: 700,
            currentStock: 25,
            reorderPoint: 5,
            unitOfMeasure: 'cup',
          },
          quantity: 2,
          unitPrice: { amountInCents: 2199, currency: 'THB' },
          discountBps: 0,
          lineSubtotal: { amountInCents: 4110, currency: 'THB' },
          lineTax: { amountInCents: 288, currency: 'THB' },
          lineTotal: { amountInCents: 4398, currency: 'THB' },
        },
      ],
      totals: {
        grossSubtotal: { amountInCents: 4398, currency: 'THB' },
        itemDiscounts: { amountInCents: 0, currency: 'THB' },
        orderDiscount: { amountInCents: 0, currency: 'THB' },
        netSubtotal: { amountInCents: 4110, currency: 'THB' },
        totalTax: { amountInCents: 288, currency: 'THB' },
        grandTotal: { amountInCents: 4398, currency: 'THB' },
        totalItemsCount: 2,
      },
      payments: [
        {
          id: crypto.randomUUID(),
          method: 'cash',
          amount: { amountInCents: 4398, currency: 'THB' },
          tenderedCash: { amountInCents: 5000, currency: 'THB' },
          changeGiven: { amountInCents: 602, currency: 'THB' },
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
  assert.equal(checkout1Res.status, 201);
  const checkout1Body = (await checkout1Res.json()) as { order: { id: string } };
  const order1Id = checkout1Body.order.id;

  // 8. One-Time Supervisor Authorization + Partial Refund (1 unit = 2199 cents)
  const supAuthRefundRes = await fetch(`${baseUrl}/api/v1/authorizations/supervisor`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      supervisorUsername: 'p4-admin',
      supervisorSecret: 'Phase4-Pass!99',
      action: 'refund',
      orderId: order1Id,
    }),
  });
  assert.equal(supAuthRefundRes.status, 201);
  const supAuthRefundBody = (await supAuthRefundRes.json()) as { authorizationToken: string };

  const refundRes = await fetch(`${baseUrl}/api/v1/orders/refund`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      orderId: order1Id,
      refundAmount: { amountInCents: 2199, currency: 'THB' },
      reason: 'Customer returned 1 item',
      refundMethod: 'cash',
      itemsToRestock: [{ productId, quantity: 1 }],
      idempotencyKey: 'idem-p4-refund-1',
      supervisorAuthorizationToken: supAuthRefundBody.authorizationToken,
    }),
  });
  assert.equal(refundRes.status, 201);

  // 9. Checkout Order #2 (1 unit @ 2199 cents) + Supervisor Authorization + Order Void
  const checkout2Res = await fetch(`${baseUrl}/api/v1/orders/checkout`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      idempotencyKey: 'idem-p4-checkout-2',
      storeId: ids.store,
      registerId: ids.register,
      cashierId: ids.adminUser,
      items: [
        {
          lineId: 'line-1',
          product: {
            id: productId,
            storeId: ids.store,
            sku: 'P4-COFFEE-01',
            barcode: '8859999000011',
            name: 'Phase 4 Signature Roast',
            categoryId: ids.category,
            price: { amountInCents: 2199, currency: 'THB' },
            costPrice: { amountInCents: 850, currency: 'THB' },
            taxRateBps: 700,
            currentStock: 24,
            reorderPoint: 5,
            unitOfMeasure: 'cup',
          },
          quantity: 1,
          unitPrice: { amountInCents: 2199, currency: 'THB' },
          discountBps: 0,
          lineSubtotal: { amountInCents: 2055, currency: 'THB' },
          lineTax: { amountInCents: 144, currency: 'THB' },
          lineTotal: { amountInCents: 2199, currency: 'THB' },
        },
      ],
      totals: {
        grossSubtotal: { amountInCents: 2199, currency: 'THB' },
        itemDiscounts: { amountInCents: 0, currency: 'THB' },
        orderDiscount: { amountInCents: 0, currency: 'THB' },
        netSubtotal: { amountInCents: 2055, currency: 'THB' },
        totalTax: { amountInCents: 144, currency: 'THB' },
        grandTotal: { amountInCents: 2199, currency: 'THB' },
        totalItemsCount: 1,
      },
      payments: [
        {
          id: crypto.randomUUID(),
          method: 'cash',
          amount: { amountInCents: 2199, currency: 'THB' },
          tenderedCash: { amountInCents: 2199, currency: 'THB' },
          changeGiven: { amountInCents: 0, currency: 'THB' },
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
  assert.equal(checkout2Res.status, 201);
  const order2Id = ((await checkout2Res.json()) as { order: { id: string } }).order.id;

  const supAuthVoidRes = await fetch(`${baseUrl}/api/v1/authorizations/supervisor`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      supervisorUsername: 'p4-admin',
      supervisorSecret: 'Phase4-Pass!99',
      action: 'void',
      orderId: order2Id,
    }),
  });
  assert.equal(supAuthVoidRes.status, 201);
  const supAuthVoidBody = (await supAuthVoidRes.json()) as { authorizationToken: string };

  const voidRes = await fetch(`${baseUrl}/api/v1/orders/void`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      orderId: order2Id,
      reason: 'Cashier entry mistake',
      idempotencyKey: 'idem-p4-void-1',
      supervisorAuthorizationToken: supAuthVoidBody.authorizationToken,
    }),
  });
  assert.equal(voidRes.status, 201);

  // 10. Shift Close + Idempotent Replay
  // Expected cash in drawer: 100000 (start) + 4398 (order 1) - 2199 (refund 1) + 2199 (order 2) - 2199 (void 2) = 102199 cents
  const shiftClose1Res = await fetch(`${baseUrl}/api/v1/shifts/${shiftId}/close`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      idempotencyKey: 'idem-p4-shift-close',
      shiftId,
      actualCountedCash: { amountInCents: 102199, currency: 'THB' },
      notes: 'Exact drawer count',
    }),
  });
  assert.equal(shiftClose1Res.status, 200);
  const shiftClose1Body = (await shiftClose1Res.json()) as {
    status: string; variance?: { amountInCents: number };
  };
  assert.equal(shiftClose1Body.status, 'closed');
  assert.equal(shiftClose1Body.variance?.amountInCents, 0);

  // Idempotent replay of shift close
  const shiftClose2Res = await fetch(`${baseUrl}/api/v1/shifts/${shiftId}/close`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      idempotencyKey: 'idem-p4-shift-close',
      shiftId,
      actualCountedCash: { amountInCents: 102199, currency: 'THB' },
      notes: 'Exact drawer count',
    }),
  });
  assert.equal(shiftClose2Res.status, 200);

  // 11. Append-Only Audit Log & Complete Audit Event Verification
  const auditLogsRes = await fetch(`${baseUrl}/api/v1/audit/logs?limit=100`, {
    headers: authHeaders,
  });
  assert.equal(auditLogsRes.status, 200);
  const auditLogs = (await auditLogsRes.json()) as Array<{ action: string; storeId: string }>;
  const recordedActions = new Set(auditLogs.map((entry) => entry.action));

  const expectedAuditActions = [
    'catalog_bulk_imported',
    'catalog_price_bulk_updated',
    'inventory_adjustment_committed',
    'shift_opened',
    'order_checkout_committed',
    'order_refund_committed',
    'order_void_committed',
    'shift_closed',
  ];

  for (const expectedAction of expectedAuditActions) {
    assert.equal(
      recordedActions.has(expectedAction),
      true,
      `Expected audit action "${expectedAction}" to be present in prodx_audit_log`,
    );
  }
});
